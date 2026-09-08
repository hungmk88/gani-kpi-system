/*
  Warnings:

  - You are about to drop the column `requestedAt` on the `cross_dept_requests` table. All the data in the column will be lost.
  - You are about to drop the column `respondedAt` on the `cross_dept_requests` table. All the data in the column will be lost.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_cross_dept_requests" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "requesterId" TEXT NOT NULL,
    "targetDeptId" TEXT NOT NULL,
    "approverId" TEXT,
    "dueDate" DATETIME NOT NULL,
    "priority" TEXT NOT NULL DEFAULT 'MEDIUM',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "rejectReason" TEXT,
    "createdTaskId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" DATETIME,
    CONSTRAINT "cross_dept_requests_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "cross_dept_requests_targetDeptId_fkey" FOREIGN KEY ("targetDeptId") REFERENCES "departments" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "cross_dept_requests_approverId_fkey" FOREIGN KEY ("approverId") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "cross_dept_requests_createdTaskId_fkey" FOREIGN KEY ("createdTaskId") REFERENCES "tasks" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_cross_dept_requests" ("approverId", "description", "dueDate", "id", "priority", "requesterId", "status", "targetDeptId", "title") SELECT "approverId", "description", "dueDate", "id", "priority", "requesterId", "status", "targetDeptId", "title" FROM "cross_dept_requests";
DROP TABLE "cross_dept_requests";
ALTER TABLE "new_cross_dept_requests" RENAME TO "cross_dept_requests";
CREATE INDEX "cross_dept_requests_status_idx" ON "cross_dept_requests"("status");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
