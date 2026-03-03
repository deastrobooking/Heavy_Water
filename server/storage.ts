import { eq, desc } from "drizzle-orm";
import { db } from "./db";
import { users, playerProgress, gameSessions, type User, type InsertUser, type PlayerProgress, type GameSession } from "@shared/schema";

export interface IStorage {
  getUser(id: number): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  updateUser(id: number, data: Partial<User>): Promise<User | undefined>;
  getPlayerProgress(userId: number): Promise<PlayerProgress | undefined>;
  savePlayerProgress(userId: number, saveData: any): Promise<PlayerProgress>;
  getLeaderboard(limit?: number): Promise<User[]>;
}

export class DatabaseStorage implements IStorage {
  async getUser(id: number): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.username, username));
    return user;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const [user] = await db.insert(users).values(insertUser).returning();
    return user;
  }

  async updateUser(id: number, data: Partial<User>): Promise<User | undefined> {
    const [user] = await db.update(users).set(data).where(eq(users.id, id)).returning();
    return user;
  }

  async getPlayerProgress(userId: number): Promise<PlayerProgress | undefined> {
    const [progress] = await db.select().from(playerProgress).where(eq(playerProgress.userId, userId));
    return progress;
  }

  async savePlayerProgress(userId: number, saveData: any): Promise<PlayerProgress> {
    const existing = await this.getPlayerProgress(userId);
    if (existing) {
      const [updated] = await db
        .update(playerProgress)
        .set({ saveData, updatedAt: new Date() })
        .where(eq(playerProgress.userId, userId))
        .returning();
      return updated;
    }
    const [created] = await db.insert(playerProgress).values({ userId, saveData }).returning();
    return created;
  }

  async getLeaderboard(limit = 10): Promise<User[]> {
    return db.select().from(users).orderBy(desc(users.highestWave), desc(users.totalKills)).limit(limit);
  }
}

export const storage = new DatabaseStorage();
