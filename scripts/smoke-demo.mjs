// Zero-setup smoke test for the seeded demo data: no Docker, no env vars, no log file.
// Start the server (`npm run dev` or `npm start`) then run `npm run test:smoke:demo`.
// Checks that the seed + auth wiring still works: login as each seeded account and hit
// one protected endpoint per role. Exits non-zero and prints the failure if anything breaks.
const BASE = process.env.SMOKE_BASE_URL || "http://localhost:3000/api";
const PASSWORD = "Demo@12345";

async function api(method, path, { token, body } = {}) {
  const response = await fetch(BASE + path, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await response.json().catch(() => null);
  return { status: response.status, message: json?.message, data: json?.data };
}

function assert(condition, detail) {
  if (!condition) throw new Error(detail);
}

async function login(email) {
  const r = await api("POST", "/auth/login", { body: { email, password: PASSWORD } });
  assert(r.status === 200, `login ${email} -> ${r.status} ${r.message}`);
  return r.data.accessToken;
}

async function main() {
  const saToken = await login("superadmin@demo.local");
  const orgs = await api("GET", "/organizations?pageSize=100", { token: saToken });
  assert(orgs.status === 200 && orgs.data.items.length >= 2, `SUPERADMIN could not list organizations: ${orgs.status}`);
  console.log(`PASS SUPERADMIN login + GET /organizations (${orgs.data.items.length} orgs)`);

  const orgA = orgs.data.items.find((o) => o.name === "Borneo Mining Co");
  const orgB = orgs.data.items.find((o) => o.name === "Java Logistics Corp");
  assert(orgA && orgB, "seeded organizations missing");

  const adminAToken = await login("admin.borneo@demo.local");
  const workersA = await api("GET", "/workers?pageSize=100", { token: adminAToken });
  assert(workersA.status === 200 && workersA.data.items.length > 0, `ADMIN (Borneo) could not list workers: ${workersA.status}`);
  assert(workersA.data.items.every((w) => w.organizationId === orgA.id), "ADMIN (Borneo) saw another organization's workers");
  console.log(`PASS ADMIN (Borneo) login + GET /workers (${workersA.data.items.length} workers, own org only)`);

  const adminBToken = await login("admin.java@demo.local");
  const workersB = await api("GET", "/workers?pageSize=100", { token: adminBToken });
  assert(workersB.status === 200 && workersB.data.items.length > 0, `ADMIN (Java) could not list workers: ${workersB.status}`);
  assert(workersB.data.items.every((w) => w.organizationId === orgB.id), "ADMIN (Java) saw another organization's workers");
  console.log(`PASS ADMIN (Java) login + GET /workers (${workersB.data.items.length} workers, own org only)`);

  const activeIncidents = await api("GET", "/incidents?status=ACTIVE&pageSize=100", { token: saToken });
  assert(activeIncidents.status === 200 && activeIncidents.data.items.length >= 1, "no ACTIVE incident found in seed data");
  console.log(`PASS seeded ACTIVE incident present (${activeIncidents.data.items.length})`);

  const resolvedIncidents = await api("GET", "/incidents?status=RESOLVED&pageSize=100", { token: saToken });
  assert(resolvedIncidents.status === 200 && resolvedIncidents.data.items.length >= 1, "no RESOLVED incident found in seed data");
  console.log(`PASS seeded RESOLVED incident present (${resolvedIncidents.data.items.length})`);

  const crossOrg = await api("GET", `/organizations/${orgB.id}`, { token: adminAToken });
  assert(crossOrg.status === 403 || crossOrg.status === 404, `ADMIN (Borneo) could read org B: ${crossOrg.status}`);
  console.log("PASS organization isolation holds (ADMIN cannot read another org)");

  console.log("\nAll smoke checks passed.");
}

main().catch((error) => {
  console.error("Smoke test FAILED:", error.message);
  process.exitCode = 1;
});
