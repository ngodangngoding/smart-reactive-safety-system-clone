import prisma from "@/lib/prisma";
import { withRoute, ok } from "@/lib/apiResponse";
import { getAuthUser, organizationScope, assertOrganizationAccess } from "@/lib/auth";
import { getDeviceUsage } from "@/lib/license";
import { OFFLINE_AFTER_MINUTES } from "@/lib/telemetryThresholds";

export const runtime = "nodejs";

export const GET = withRoute(async (request) => {
  const user = await getAuthUser(request);
  const organizationId = request.nextUrl.searchParams.get("organizationId");
  if (organizationId) assertOrganizationAccess(user, organizationId);
  const scope = { ...organizationScope(user), ...(organizationId ? { organizationId } : {}) };
  const scoped = Boolean(scope.organizationId);
  const live = { is_deleted: false };

  const activeNodes = await prisma.workerNode.findMany({ where: { ...live, isActive: true, ...scope }, select: { id: true } });
  const cutoff = new Date(Date.now() - OFFLINE_AFTER_MINUTES * 60 * 1000);
  const latestPerNode = await Promise.all(
    activeNodes.map((node) => prisma.telemetry.findFirst({ where: { workerNodeId: node.id, is_deleted: false }, orderBy: { receivedAt: "desc" }, select: { receivedAt: true } }))
  );
  const connection = { total: activeNodes.length, online: latestPerNode.filter((t) => t && t.receivedAt > cutoff).length };

  const [workers, workerNodes, activeIncidents] = await Promise.all([
    prisma.worker.count({ where: { ...live, ...scope } }),
    prisma.workerNode.count({ where: { ...live, ...scope } }),
    prisma.incident.count({ where: { ...live, ...scope, status: "ACTIVE" } }),
  ]);

  let deviceUsage;
  let organizations;
  if (scoped) {
    deviceUsage = await getDeviceUsage(prisma, scope.organizationId);
  } else {
    const orgs = await prisma.organization.findMany({
      where: { ...live, isActive: true },
      select: { license: { select: { maxDevice: true, is_deleted: true } } },
    });
    organizations = orgs.length;
    deviceUsage = { used: workerNodes, max: orgs.reduce((sum, org) => sum + (org.license && !org.license.is_deleted ? org.license.maxDevice : 0), 0) };
  }

  return ok({
    workers,
    workerNodes,
    online: connection.online,
    offline: connection.total - connection.online,
    activeIncidents,
    deviceUsage,
    ...(organizations !== undefined ? { organizations } : {}),
  });
});
