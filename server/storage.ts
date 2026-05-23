import { eq, desc, and } from "drizzle-orm";
import { db } from "./db";
import {
  users, playerProgress, gameSessions, playerPets, playerArmorModules,
  type User, type InsertUser, type PlayerProgress, type GameSession,
  type PlayerPet, type PlayerArmorModule,
} from "@shared/schema";

export interface IStorage {
  getUser(id: number): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  updateUser(id: number, data: Partial<User>): Promise<User | undefined>;
  getPlayerProgress(userId: number): Promise<PlayerProgress | undefined>;
  savePlayerProgress(userId: number, saveData: any): Promise<PlayerProgress>;
  getLeaderboard(limit?: number): Promise<User[]>;
  // ---- player pets
  getPlayerPets(userId: number): Promise<PlayerPet[]>;
  addPlayerPet(userId: number, pet: Omit<PlayerPet, "id" | "userId" | "createdAt">): Promise<PlayerPet>;
  removePlayerPet(userId: number, creatureId: string): Promise<void>;
  updatePlayerPetLevel(userId: number, creatureId: string, level: number): Promise<void>;
  // ---- armor modules
  getArmorModules(userId: number): Promise<PlayerArmorModule[]>;
  addArmorModule(userId: number, mod: Omit<PlayerArmorModule, "id" | "userId" | "createdAt">): Promise<PlayerArmorModule>;
  removeArmorModule(userId: number, moduleId: string): Promise<void>;
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

  // ---- Player Pets ----
  async getPlayerPets(userId: number): Promise<PlayerPet[]> {
    return db.select().from(playerPets).where(eq(playerPets.userId, userId));
  }

  async addPlayerPet(userId: number, pet: Omit<PlayerPet, "id" | "userId" | "createdAt">): Promise<PlayerPet> {
    const [created] = await db.insert(playerPets).values({ ...pet, userId }).returning();
    return created;
  }

  async removePlayerPet(userId: number, creatureId: string): Promise<void> {
    await db.delete(playerPets).where(and(eq(playerPets.userId, userId), eq(playerPets.creatureId, creatureId)));
  }

  async updatePlayerPetLevel(userId: number, creatureId: string, level: number): Promise<void> {
    await db.update(playerPets).set({ level }).where(and(eq(playerPets.userId, userId), eq(playerPets.creatureId, creatureId)));
  }

  // ---- Armor Modules ----
  async getArmorModules(userId: number): Promise<PlayerArmorModule[]> {
    return db.select().from(playerArmorModules).where(eq(playerArmorModules.userId, userId));
  }

  async addArmorModule(userId: number, mod: Omit<PlayerArmorModule, "id" | "userId" | "createdAt">): Promise<PlayerArmorModule> {
    const [created] = await db.insert(playerArmorModules).values({ ...mod, userId }).returning();
    return created;
  }

  async removeArmorModule(userId: number, moduleId: string): Promise<void> {
    await db.delete(playerArmorModules).where(and(eq(playerArmorModules.userId, userId), eq(playerArmorModules.moduleId, moduleId)));
  }
}

export const storage = new DatabaseStorage();
