import prisma from "@/lib/prisma";
import { toSafeUser } from "@/lib/auth";
import { issueTokens } from "@/lib/tokens";
import { assertOrganizationOperational, getOrganizationSummary } from "@/lib/license";
import { getPermissionMenu } from "@/lib/permissions";

export async function createLoginSession(user, { viaGoogle = false } = {}) {
  const linkNow = viaGoogle && !user.googleLinkedAt;
  if (user.role === "ADMIN") await assertOrganizationOperational(prisma, user.organizationId);

  const now = new Date();
  try {
    await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: now, ...(linkNow ? { googleLinkedAt: now } : {}) } });
  } catch (error) {
    console.error("Failed to record login time:", error.message);
  }
  user = { ...user, lastLoginAt: now, ...(linkNow ? { googleLinkedAt: now } : {}) };

  return {
    ...issueTokens(user),
    user: toSafeUser(user),
    organization: await getOrganizationSummary(prisma, user.organizationId),
    permissions: getPermissionMenu(user.role),
  };
}
