import { PrismaClient } from "@prisma/client";
import { Pool } from "pg";

export const prisma = new PrismaClient();

export const timescalePool = new Pool({
  connectionString: process.env.DATABASE_URL
});
