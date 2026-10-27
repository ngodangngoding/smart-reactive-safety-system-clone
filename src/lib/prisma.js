// In-memory stand-in for the Prisma client: a self-contained demo build runs with zero
// external infrastructure (no Postgres, no connection string). Every "table" is a Map,
// seeded once below. Data resets on process restart -- that's expected for a demo.
//
// Implements only the query shapes this codebase actually uses (see each model's call
// sites): findMany/findFirst/findUnique/count/create/update/updateMany/groupBy, plus
// $transaction and a no-op $executeRaw. No speculative generality beyond that.
import crypto from "node:crypto";
import { hashPassword } from "@/lib/password";

// ---------------------------------------------------------------------------
// Relation + uniqueness metadata (only the relations actually referenced by
// include/select/where clauses across the app -- see src/app/api/**/route.js).
// ---------------------------------------------------------------------------

const RELATIONS = {
  organization: {
    license: { type: "one", model: "license", fk: "licenseId" },
    users: { type: "many", model: "user", fk: "organizationId" },
    workers: { type: "many", model: "worker", fk: "organizationId" },
    workerNodes: { type: "many", model: "workerNode", fk: "organizationId" },
    incidents: { type: "many", model: "incident", fk: "organizationId" },
  },
  user: {
    organization: { type: "one", model: "organization", fk: "organizationId" },
  },
  worker: {
    organization: { type: "one", model: "organization", fk: "organizationId" },
    workerNode: { type: "manyAsOne", model: "workerNode", fk: "workerId" },
    incidents: { type: "many", model: "incident", fk: "workerId" },
  },
  workerNode: {
    organization: { type: "one", model: "organization", fk: "organizationId" },
    worker: { type: "one", model: "worker", fk: "workerId" },
  },
  telemetry: {
    workerNode: { type: "one", model: "workerNode", fk: "workerNodeId" },
  },
  incident: {
    organization: { type: "one", model: "organization", fk: "organizationId" },
    workerNode: { type: "one", model: "workerNode", fk: "workerNodeId" },
    worker: { type: "one", model: "worker", fk: "workerId" },
    resolvedBy: { type: "one", model: "user", fk: "resolvedById" },
    triggerTelemetry: { type: "one", model: "telemetry", fk: "triggerTelemetryId" },
  },
  auditLog: {
    organization: { type: "one", model: "organization", fk: "organizationId" },
    performedBy: { type: "one", model: "user", fk: "performedByUserId" },
  },
  license: {},
};

const UNIQUE_FIELDS = {
  user: ["email"],
  worker: ["workerCode"],
  workerNode: ["deviceWorkerId", "workerId"],
  organization: ["licenseId"],
};

const MODEL_DEFAULTS = {
  license: () => ({ is_deleted: false, deletedAt: null }),
  organization: () => ({ isActive: true, licenseId: null, is_deleted: false, deletedAt: null }),
  user: () => ({ hasPassword: true, avatarUrl: null, tokenVersion: 0, lastLoginAt: null, googleLinkedAt: null, organizationId: null, isActive: true, is_deleted: false, deletedAt: null }),
  worker: () => ({ isActive: true, is_deleted: false, deletedAt: null }),
  workerNode: () => ({ deviceWorkerId: null, workerId: null, archivedDeviceWorkerId: null, archivedWorkerId: null, isActive: true, is_deleted: false, deletedAt: null }),
  telemetry: () => ({ is_deleted: false }),
  incident: () => ({ status: "ACTIVE", resolvedAt: null, resolvedById: null, triggerTelemetryId: null, latitude: null, longitude: null, altitude: null, satellites: null, resolutionNote: null, is_deleted: false, deletedAt: null }),
  auditLog: () => ({ organizationId: null, performedByUserId: null, metadata: null, is_deleted: false }),
};

const TIMESTAMP_FIELDS = {
  license: ["createdAt", "updatedAt"],
  organization: ["createdAt", "updatedAt"],
  user: ["createdAt", "updatedAt"],
  worker: ["createdAt", "updatedAt"],
  workerNode: ["createdAt", "updatedAt"],
  telemetry: ["receivedAt"],
  incident: ["createdAt", "updatedAt", "startedAt"],
  auditLog: ["createdAt"],
};

// ---------------------------------------------------------------------------
// Query engine
// ---------------------------------------------------------------------------

function matchScalar(fieldValue, condition) {
  if (condition === null) return fieldValue === null || fieldValue === undefined;
  if (typeof condition !== "object" || condition instanceof Date) return fieldValue === condition;

  let ok = true;
  if ("equals" in condition) ok &&= fieldValue === condition.equals;
  if ("in" in condition) ok &&= condition.in.includes(fieldValue);
  if ("notIn" in condition) ok &&= !condition.notIn.includes(fieldValue);
  if ("not" in condition) ok &&= condition.not === null ? fieldValue !== null && fieldValue !== undefined : fieldValue !== condition.not;
  if ("gte" in condition) ok &&= fieldValue >= condition.gte;
  if ("lte" in condition) ok &&= fieldValue <= condition.lte;
  if ("gt" in condition) ok &&= fieldValue > condition.gt;
  if ("lt" in condition) ok &&= fieldValue < condition.lt;
  if ("contains" in condition) {
    const haystack = String(fieldValue ?? "");
    const needle = String(condition.contains);
    ok &&= condition.mode === "insensitive" ? haystack.toLowerCase().includes(needle.toLowerCase()) : haystack.includes(needle);
  }
  return ok;
}

function fetchRelatedOne(record, rel) {
  if (rel.type === "one") {
    const fkValue = record[rel.fk];
    return fkValue != null ? (stores[rel.model].get(fkValue) ?? null) : null;
  }
  if (rel.type === "manyAsOne") {
    for (const candidate of stores[rel.model].values()) {
      if (candidate[rel.fk] === record.id) return candidate;
    }
    return null;
  }
  return null;
}

function matchWhere(record, where, modelName) {
  if (!where) return true;
  for (const [key, value] of Object.entries(where)) {
    if (key === "OR") {
      if (!value.some((sub) => matchWhere(record, sub, modelName))) return false;
      continue;
    }
    if (key === "AND") {
      if (!value.every((sub) => matchWhere(record, sub, modelName))) return false;
      continue;
    }
    const rel = RELATIONS[modelName]?.[key];
    if (rel) {
      const target = fetchRelatedOne(record, rel);
      if (value === null) {
        if (target !== null) return false;
        continue;
      }
      if (!target) return false;
      const nestedWhere = "is" in value ? value.is : value;
      if (!matchWhere(target, nestedWhere, rel.model)) return false;
      continue;
    }
    if (!matchScalar(record[key], value)) return false;
  }
  return true;
}

function applyOrderBy(list, orderBy) {
  if (!orderBy) return list;
  const [field] = Object.keys(orderBy);
  const spec = orderBy[field];
  const dir = typeof spec === "string" ? spec : spec.sort;
  const nullsLast = typeof spec === "object" && spec.nulls === "last";

  return list
    .map((record, index) => ({ record, index, value: record[field] }))
    .sort((a, b) => {
      const aNull = a.value === null || a.value === undefined;
      const bNull = b.value === null || b.value === undefined;
      if (aNull && bNull) return a.index - b.index;
      if (aNull) return nullsLast ? 1 : -1;
      if (bNull) return nullsLast ? -1 : 1;
      if (a.value < b.value) return dir === "asc" ? -1 : 1;
      if (a.value > b.value) return dir === "asc" ? 1 : -1;
      return a.index - b.index;
    })
    .map((entry) => entry.record);
}

function cloneRecord(record) {
  return { ...record };
}

function buildCount(record, modelName, countSelect) {
  const out = {};
  for (const [relName, opts] of Object.entries(countSelect)) {
    const rel = RELATIONS[modelName][relName];
    const list = [...stores[rel.model].values()].filter((r) => r[rel.fk] === record.id);
    out[relName] = (opts?.where ? list.filter((r) => matchWhere(r, opts.where, rel.model)) : list).length;
  }
  return out;
}

function projectRelationTarget(target, model, spec) {
  if (!target) return null;
  if (spec === true || spec == null) return cloneRecord(target);
  if (spec.select) return applyProjection(target, model, spec.select, "select");
  if (spec.include) return applyProjection(target, model, spec.include, "include");
  return cloneRecord(target);
}

function resolveRelation(record, modelName, relName, spec) {
  const rel = RELATIONS[modelName][relName];
  if (rel.type === "one" || rel.type === "manyAsOne") {
    return projectRelationTarget(fetchRelatedOne(record, rel), rel.model, spec);
  }
  // type === "many"
  const opts = spec === true ? {} : spec;
  let list = [...stores[rel.model].values()].filter((r) => r[rel.fk] === record.id);
  if (opts.where) list = list.filter((r) => matchWhere(r, opts.where, rel.model));
  list = applyOrderBy(list, opts.orderBy);
  if (typeof opts.skip === "number") list = list.slice(opts.skip);
  if (typeof opts.take === "number") list = list.slice(0, opts.take);
  return list.map((r) => projectRelationTarget(r, rel.model, opts));
}

function applyProjection(record, modelName, spec, mode) {
  const out = mode === "include" ? cloneRecord(record) : {};
  for (const [key, value] of Object.entries(spec)) {
    if (value === false) continue;
    if (key === "_count") {
      out._count = buildCount(record, modelName, value.select);
      continue;
    }
    if (RELATIONS[modelName]?.[key]) {
      out[key] = resolveRelation(record, modelName, key, value);
      continue;
    }
    out[key] = record[key];
  }
  return out;
}

function project(record, modelName, { include, select } = {}) {
  if (select) return applyProjection(record, modelName, select, "select");
  if (include) return applyProjection(record, modelName, include, "include");
  return cloneRecord(record);
}

function prismaError(code, message, meta) {
  const error = new Error(message);
  error.code = code;
  if (meta) error.meta = meta;
  return error;
}

function checkUnique(modelName, data, excludeId) {
  for (const field of UNIQUE_FIELDS[modelName] ?? []) {
    if (!(field in data)) continue;
    const value = data[field];
    if (value === null || value === undefined) continue;
    for (const record of stores[modelName].values()) {
      if (record.id !== excludeId && record[field] === value) {
        throw prismaError("P2002", `Unique constraint failed on the fields: (\`${field}\`)`, { target: [field] });
      }
    }
  }
}

function applyIncrements(existing, data) {
  const patch = {};
  for (const [key, value] of Object.entries(data)) {
    patch[key] = value && typeof value === "object" && !(value instanceof Date) && "increment" in value ? (existing[key] ?? 0) + value.increment : value;
  }
  return patch;
}

function makeModel(modelName) {
  const store = stores[modelName];

  // Methods are synchronous (no real I/O); route code still works since every call site
  // uses `await`, and `await` on a plain value just resolves on the next microtask.
  return {
    findMany({ where, include, select, orderBy, skip, take } = {}) {
      let list = [...store.values()].filter((r) => matchWhere(r, where, modelName));
      list = applyOrderBy(list, orderBy);
      if (typeof skip === "number") list = list.slice(skip);
      if (typeof take === "number") list = list.slice(0, take);
      return list.map((r) => project(r, modelName, { include, select }));
    },
    findFirst({ where, include, select, orderBy } = {}) {
      let list = [...store.values()].filter((r) => matchWhere(r, where, modelName));
      list = applyOrderBy(list, orderBy);
      return list.length ? project(list[0], modelName, { include, select }) : null;
    },
    findUnique({ where, include, select } = {}) {
      const record = where?.id !== undefined ? store.get(where.id) ?? null : [...store.values()].find((r) => matchWhere(r, where, modelName)) ?? null;
      return record ? project(record, modelName, { include, select }) : null;
    },
    count({ where } = {}) {
      return [...store.values()].filter((r) => matchWhere(r, where, modelName)).length;
    },
    groupBy({ by, where, _count }) {
      const list = [...store.values()].filter((r) => matchWhere(r, where, modelName));
      const groups = new Map();
      for (const record of list) {
        const key = by.map((field) => record[field]).join("\u0000");
        if (!groups.has(key)) groups.set(key, { keys: by.map((field) => record[field]), count: 0 });
        groups.get(key).count += 1;
      }
      return [...groups.values()].map((group) => ({
        ...Object.fromEntries(by.map((field, i) => [field, group.keys[i]])),
        ...(_count ? { _count: { _all: group.count } } : {}),
      }));
    },
    create({ data, include, select } = {}) {
      checkUnique(modelName, data, null);
      const now = new Date();
      const record = { id: crypto.randomUUID(), ...MODEL_DEFAULTS[modelName](), ...data };
      for (const field of TIMESTAMP_FIELDS[modelName]) record[field] = now;
      store.set(record.id, record);
      return project(record, modelName, { include, select });
    },
    update({ where, data, include, select }) {
      const existing = store.get(where.id);
      if (!existing) throw prismaError("P2025", "Record to update not found.");
      const patch = applyIncrements(existing, data);
      checkUnique(modelName, patch, existing.id);
      const updated = { ...existing, ...patch };
      if (TIMESTAMP_FIELDS[modelName].includes("updatedAt")) updated.updatedAt = new Date();
      store.set(existing.id, updated);
      return project(updated, modelName, { include, select });
    },
    updateMany({ where, data }) {
      const list = [...store.values()].filter((r) => matchWhere(r, where, modelName));
      for (const existing of list) {
        const patch = applyIncrements(existing, data);
        const updated = { ...existing, ...patch };
        if (TIMESTAMP_FIELDS[modelName].includes("updatedAt")) updated.updatedAt = new Date();
        store.set(existing.id, updated);
      }
      return { count: list.length };
    },
  };
}

// ---------------------------------------------------------------------------
// Store construction + seed
// ---------------------------------------------------------------------------

function buildDatabase() {
  const db = {
    license: makeModel("license"),
    organization: makeModel("organization"),
    user: makeModel("user"),
    worker: makeModel("worker"),
    workerNode: makeModel("workerNode"),
    telemetry: makeModel("telemetry"),
    incident: makeModel("incident"),
    auditLog: makeModel("auditLog"),
    // ponytail: single-process in-memory store has no real transactions to begin/rollback;
    // the callback just runs against the same store. Good enough for a demo, not for prod.
    async $transaction(fnOrArray, _options) {
      if (typeof fnOrArray === "function") return fnOrArray(db);
      return Promise.all(fnOrArray);
    },
    // Raw SQL has no meaning without a real database; the two call sites only use this for
    // a Postgres advisory lock, which a single-threaded in-memory store doesn't need.
    async $executeRaw() {
      return 0;
    },
  };
  return db;
}

function daysFromNow(days) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function minutesAgo(minutes) {
  return new Date(Date.now() - minutes * 60 * 1000);
}

const DEMO_PASSWORD = "Demo@12345";

function seed(db) {
  const licenseA = db.license.create({ data: { name: "Standard Plan", maxDevice: 10, startDate: daysFromNow(-30), endDate: daysFromNow(335) } });
  const licenseB = db.license.create({ data: { name: "Enterprise Plan", maxDevice: 10, startDate: daysFromNow(-30), endDate: daysFromNow(335) } });

  const orgA = db.organization.create({ data: { name: "Borneo Mining Co", licenseId: licenseA.id } });
  const orgB = db.organization.create({ data: { name: "Java Logistics Corp", licenseId: licenseB.id } });

  const passwordHash = hashPassword(DEMO_PASSWORD);
  const superadmin = db.user.create({ data: { name: "Super Admin", email: "superadmin@demo.local", passwordHash, role: "SUPERADMIN" } });
  const adminA = db.user.create({ data: { name: "Admin Borneo", email: "admin.borneo@demo.local", passwordHash, role: "ADMIN", organizationId: orgA.id } });
  const adminB = db.user.create({ data: { name: "Admin Java", email: "admin.java@demo.local", passwordHash, role: "ADMIN", organizationId: orgB.id } });

  function seedOrg({ org, admin, codePrefix, names, baseDeviceId }) {
    const workers = [];
    for (const [i, name] of names.entries()) {
      const worker = db.worker.create({ data: { organizationId: org.id, workerCode: `${codePrefix}-${String(i + 1).padStart(3, "0")}`, name } });
      const node = db.workerNode.create({ data: { organizationId: org.id, workerId: worker.id, deviceWorkerId: baseDeviceId + i } });
      workers.push({ worker, node });
      db.auditLog.create({ data: { organizationId: org.id, performedByUserId: admin.id, action: "CREATE_WORKER", metadata: { target: { table: "Worker", id: worker.id } } } });
    }
    return workers;
  }

  const workersA = seedOrg({ org: orgA, admin: adminA, codePrefix: "BRN", names: ["Ahmad Rahman", "Budi Santoso", "Citra Dewi", "Dedi Kurniawan"], baseDeviceId: 1001 });
  const workersB = seedOrg({ org: orgB, admin: adminB, codePrefix: "JKT", names: ["Eka Putri", "Fajar Nugroho", "Gita Lestari", "Hendra Wijaya"], baseDeviceId: 2001 });

  // Telemetry history: 12 points per node, 15 minutes apart, ending "now" so dashboards show ONLINE on first load.
  function seedTelemetry(node, { baseLat, baseLon, sosAt = null } = {}) {
    const points = [];
    for (let i = 11; i >= 0; i--) {
      const receivedAt = minutesAgo(i * 15);
      const sos = sosAt === i;
      const telemetry = db.telemetry.create({
        data: {
          workerNodeId: node.id,
          sequence: 12 - i,
          accelY: 0.01 + Math.random() * 0.02,
          accelX: 0.01 + Math.random() * 0.02,
          accelZ: 9.78 + Math.random() * 0.06,
          gyroX: Math.random() * 0.2 - 0.1,
          gyroY: Math.random() * 0.2 - 0.1,
          gyroZ: Math.random() * 0.2 - 0.1,
          longitude: Number((baseLon + (Math.random() - 0.5) * 0.01).toFixed(7)),
          latitude: Number((baseLat + (Math.random() - 0.5) * 0.01).toFixed(7)),
          deviceTimestamp: Math.floor(receivedAt.getTime() / 1000),
          temperature: 27 + Math.random() * 6,
          sos,
          satellites: 8 + Math.floor(Math.random() * 4),
          altitude: 10 + Math.random() * 20,
          batteryPercent: Math.max(15, 90 - i * 3),
          humidity: 55 + Math.random() * 15,
          pressure: 1005 + Math.random() * 10,
          batteryVoltage: 3.7 + Math.random() * 0.3,
          receivedAt,
        },
      });
      points.push(telemetry);
    }
    return points;
  }

  // Worker 1 of org A: fresh SOS right now -> ACTIVE incident, visible immediately.
  const [a1] = workersA;
  const a1Points = seedTelemetry(a1.node, { baseLat: -1.2, baseLon: 116.8, sosAt: 0 });
  for (const { node } of workersA.slice(1)) seedTelemetry(node, { baseLat: -1.2, baseLon: 116.8 });

  const trigger = a1Points[a1Points.length - 1];
  const activeIncident = db.incident.create({
    data: {
      organizationId: orgA.id,
      workerNodeId: a1.node.id,
      workerId: a1.worker.id,
      status: "ACTIVE",
      triggerTelemetryId: trigger.id,
      latitude: trigger.latitude,
      longitude: trigger.longitude,
      altitude: trigger.altitude,
      satellites: trigger.satellites,
    },
  });
  db.auditLog.create({ data: { organizationId: orgA.id, action: "CREATE_INCIDENT", metadata: { target: { table: "Incident", id: activeIncident.id }, triggerTelemetryId: trigger.id } } });

  // Worker 1 of org B: an older SOS that was already handled -> RESOLVED incident.
  const [b1] = workersB;
  const b1Points = seedTelemetry(b1.node, { baseLat: -6.2, baseLon: 106.8, sosAt: 6 });
  for (const { node } of workersB.slice(1)) seedTelemetry(node, { baseLat: -6.2, baseLon: 106.8 });

  const resolvedTrigger = b1Points[5];
  const resolvedIncident = db.incident.create({
    data: {
      organizationId: orgB.id,
      workerNodeId: b1.node.id,
      workerId: b1.worker.id,
      status: "RESOLVED",
      triggerTelemetryId: resolvedTrigger.id,
      latitude: resolvedTrigger.latitude,
      longitude: resolvedTrigger.longitude,
      altitude: resolvedTrigger.altitude,
      satellites: resolvedTrigger.satellites,
      resolvedAt: minutesAgo(60),
      resolvedById: adminB.id,
      resolutionNote: "False alarm - worker was fine, checked in by radio.",
    },
  });
  db.auditLog.create({ data: { organizationId: orgB.id, performedByUserId: adminB.id, action: "RESOLVE_INCIDENT", metadata: { target: { table: "Incident", id: resolvedIncident.id }, note: resolvedIncident.resolutionNote } } });

  db.auditLog.create({ data: { performedByUserId: superadmin.id, action: "CREATE_ORGANIZATION", metadata: { target: { table: "Organization", id: orgA.id } } } });
  db.auditLog.create({ data: { performedByUserId: superadmin.id, action: "CREATE_ORGANIZATION", metadata: { target: { table: "Organization", id: orgB.id } } } });
}

const stores = globalThis.__memoryDbStores ?? {
  license: new Map(),
  organization: new Map(),
  user: new Map(),
  worker: new Map(),
  workerNode: new Map(),
  telemetry: new Map(),
  incident: new Map(),
  auditLog: new Map(),
};

if (!globalThis.__memoryDb) {
  globalThis.__memoryDbStores = stores;
  globalThis.__memoryDb = buildDatabase();
  seed(globalThis.__memoryDb);
}

const prisma = globalThis.__memoryDb;

export default prisma;
