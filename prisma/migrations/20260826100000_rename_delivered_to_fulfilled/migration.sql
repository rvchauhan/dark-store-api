-- Rename order status enum value delivered → fulfilled (matches Prisma schema).
ALTER TYPE "order_status" RENAME VALUE 'delivered' TO 'fulfilled';
