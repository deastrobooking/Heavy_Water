import { pgTable, text, serial, integer, boolean, timestamp, jsonb, varchar } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
  displayName: text("display_name"),
  level: integer("level").default(1).notNull(),
  credits: integer("credits").default(0).notNull(),
  experience: integer("experience").default(0).notNull(),
  highestWave: integer("highest_wave").default(0).notNull(),
  totalKills: integer("total_kills").default(0).notNull(),
  hasFlightArmor: boolean("has_flight_armor").default(false).notNull(),
  lastLogin: timestamp("last_login"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const playerProgress = pgTable("player_progress", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  saveData: jsonb("save_data"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const gameSessions = pgTable("game_sessions", {
  id: serial("id").primaryKey(),
  roomCode: varchar("room_code", { length: 8 }).notNull().unique(),
  hostUserId: integer("host_user_id").notNull(),
  maxPlayers: integer("max_players").default(4).notNull(),
  currentPlayers: integer("current_players").default(1).notNull(),
  status: varchar("status", { length: 20 }).default("waiting").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const userSessions = pgTable("user_sessions", {
  sid: text("sid").primaryKey(),
  sess: jsonb("sess").notNull(),
  expire: timestamp("expire").notNull(),
});

/** Active bio-creature pets that follow the player and augment abilities.
 *  Up to 3 active pets per player; each pet is a captured creature with
 *  an independent active-pet level (1-50) separate from the garden roster. */
export const playerPets = pgTable("player_pets", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  creatureId: text("creature_id").notNull(),
  speciesId: text("species_id").notNull(),
  name: text("name").default("Unknown Pet").notNull(),
  level: integer("level").default(1).notNull(),
  elementalType: text("elemental_type"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

/** Loose armor modules in the player's inventory (not yet socketed into armor).
 *  These are distinct from modules already installed in equipped armor pieces,
 *  which are stored inside the `equippedArmor` JSONB in player_progress. */
export const playerArmorModules = pgTable("player_armor_modules", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  moduleId: text("module_id").notNull(),
  name: text("name").notNull(),
  type: text("type").notNull(),
  tier: integer("tier").default(1).notNull(),
  level: integer("level").default(1).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
export type PlayerProgress = typeof playerProgress.$inferSelect;
export type GameSession = typeof gameSessions.$inferSelect;
export type PlayerPet = typeof playerPets.$inferSelect;
export type PlayerArmorModule = typeof playerArmorModules.$inferSelect;
