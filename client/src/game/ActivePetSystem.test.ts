import assert from "node:assert/strict";
import test from "node:test";
import * as BABYLON from "@babylonjs/core";
import {
  ActivePetSystem,
  calculatePetFollowStep,
  normalizePetAssignment,
  strongestPetAssignment,
  type PetAssignment,
} from "./ActivePetSystem";
import type { CapturedCreature } from "./BioCreatureSystem";

const captured = (id: string, speciesId: string, level: number): CapturedCreature => ({
  id,
  speciesId,
  name: id,
  level,
  hp: 100,
  attackPower: 10,
  speed: 1,
  bondLevel: 0,
  care: 100,
});

const roster = [
  captured("low", "robofox", 10),
  captured("high", "crystalbeetle", 90),
  captured("mid", "hoverserpent", 50),
  captured("extra", "neonowl", 30),
];

const ids = (assignment: PetAssignment[]) => assignment.map(({ creatureId }) => creatureId);

test("legacy saves without activePets use the strongest three valid captures", () => {
  assert.deepEqual(ids(strongestPetAssignment(roster)), ["high", "mid", "extra"]);
});

test("explicit ordered loadouts round-trip without sorting", () => {
  const chosen = [
    { creatureId: "low", level: 1 },
    { creatureId: "high", level: 1 },
    { creatureId: "mid", level: 1 },
  ];
  const restored = normalizePetAssignment(chosen, roster, true);
  assert.deepEqual(ids(restored), ["low", "high", "mid"]);
  assert.deepEqual(normalizePetAssignment(restored, roster, true), restored);
});

test("an explicit empty loadout remains empty", () => {
  assert.deepEqual(normalizePetAssignment([], roster, true), []);
});

test("missing selected pets repair only vacant slots", () => {
  const saved = [
    { creatureId: "low", level: 10 },
    { creatureId: "deployed", level: 80 },
    { creatureId: "mid", level: 50 },
  ];
  const repaired = normalizePetAssignment(saved, roster, true);
  assert.deepEqual(ids(repaired), ["low", "high", "mid"]);
  assert.equal(repaired[0].creatureId, "low");
  assert.equal(repaired[2].creatureId, "mid");
});

test("rapid loadout changes undo only the immediately previous ordered lineup", () => {
  const engine = new BABYLON.NullEngine({ renderWidth: 1, renderHeight: 1 });
  const scene = new BABYLON.Scene(engine);
  const pets = new ActivePetSystem(scene);

  try {
    const initial = [
      { creatureId: "low", level: 1 },
      { creatureId: "high", level: 1 },
      { creatureId: "mid", level: 1 },
    ];
    const reorderedAndRemoved = [
      { creatureId: "mid", level: 1 },
      { creatureId: "low", level: 1 },
    ];
    const replacement = [
      { creatureId: "extra", level: 1 },
      { creatureId: "high", level: 1 },
    ];

    pets.assignPets(initial, roster);
    pets.assignPets(reorderedAndRemoved, roster);
    pets.assignPets(replacement, roster);

    // A rapid second assignment must not overwrite the one-step undo target.
    assert.deepEqual(ids(pets.getEntries()), ["extra", "high"]);
    assert.equal(pets.undoPreviousLoadout(roster), true);
    assert.deepEqual(ids(pets.getEntries()), ["mid", "low"]);
    assert.equal(pets.hasPreviousLoadout(), false);

    // Repeated changes continue to replace the buffer with the latest lineup.
    pets.assignPets([], roster);
    pets.assignPets(replacement, roster);
    assert.equal(pets.undoPreviousLoadout(roster), true);
    assert.deepEqual(ids(pets.getEntries()), []);

    // An intentionally empty lineup is meaningful and can itself be undone to.
    pets.assignPets([{ creatureId: "low", level: 1 }], roster);
    assert.equal(pets.undoPreviousLoadout(roster), true);
    assert.deepEqual(ids(pets.getEntries()), []);
    assert.equal(pets.undoPreviousLoadout(roster), false);
  } finally {
    pets.dispose();
    scene.dispose();
    engine.dispose();
  }
});

test("follower smoothing responds to delta time and snaps after a large gap", () => {
  const current = BABYLON.Vector3.Zero();
  const target = new BABYLON.Vector3(10, 0, 0);
  const smallStep = calculatePetFollowStep(current, target, 1 / 60);
  const largeStep = calculatePetFollowStep(current, target, 0.1);

  assert.ok(smallStep.x > 0 && smallStep.x < target.x);
  assert.ok(largeStep.x > smallStep.x && largeStep.x < target.x);
  assert.deepEqual(
    calculatePetFollowStep(current, new BABYLON.Vector3(30, 0, 0), 1 / 60).asArray(),
    [30, 0, 0],
  );
});