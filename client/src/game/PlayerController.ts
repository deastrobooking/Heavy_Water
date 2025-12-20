import * as BABYLON from "@babylonjs/core";

export interface PlayerStats {
  health: number;
  maxHealth: number;
  armor: number;
  maxArmor: number;
  credits: number;
  experience: number;
  level: number;
}

export class PlayerController {
  private scene: BABYLON.Scene;
  private camera: BABYLON.FreeCamera;
  private mesh: BABYLON.Mesh;
  private velocity: BABYLON.Vector3 = BABYLON.Vector3.Zero();
  private isGrounded: boolean = true;
  private moveSpeed: number = 0.3;
  private jumpForce: number = 0.5;
  private gravity: number = 0.02;
  
  private keys: { [key: string]: boolean } = {};
  private stats: PlayerStats;

  constructor(scene: BABYLON.Scene, camera: BABYLON.FreeCamera) {
    this.scene = scene;
    this.camera = camera;
    this.mesh = this.createPlayerMesh();
    this.stats = {
      health: 100,
      maxHealth: 100,
      armor: 50,
      maxArmor: 100,
      credits: 0,
      experience: 0,
      level: 1,
    };
    this.setupControls();
  }

  private createPlayerMesh(): BABYLON.Mesh {
    const player = BABYLON.MeshBuilder.CreateCapsule(
      "player",
      { height: 2, radius: 0.5 },
      this.scene
    );
    player.position = new BABYLON.Vector3(0, 3, -15);
    player.isVisible = false;
    return player;
  }

  private setupControls(): void {
    window.addEventListener("keydown", (e) => {
      this.keys[e.code] = true;
      if (e.code === "Space" && this.isGrounded) {
        this.jump();
      }
    });

    window.addEventListener("keyup", (e) => {
      this.keys[e.code] = false;
    });
  }

  private jump(): void {
    if (this.isGrounded) {
      this.velocity.y = this.jumpForce;
      this.isGrounded = false;
    }
  }

  update(): void {
    const forward = this.camera.getDirection(BABYLON.Vector3.Forward());
    const right = this.camera.getDirection(BABYLON.Vector3.Right());
    
    forward.y = 0;
    right.y = 0;
    forward.normalize();
    right.normalize();

    let moveDirection = BABYLON.Vector3.Zero();

    if (this.keys["KeyW"]) {
      moveDirection.addInPlace(forward.scale(this.moveSpeed));
    }
    if (this.keys["KeyS"]) {
      moveDirection.addInPlace(forward.scale(-this.moveSpeed));
    }
    if (this.keys["KeyA"]) {
      moveDirection.addInPlace(right.scale(-this.moveSpeed));
    }
    if (this.keys["KeyD"]) {
      moveDirection.addInPlace(right.scale(this.moveSpeed));
    }

    this.velocity.x = moveDirection.x;
    this.velocity.z = moveDirection.z;

    if (!this.isGrounded) {
      this.velocity.y -= this.gravity;
    }

    this.mesh.position.addInPlace(this.velocity);

    if (this.mesh.position.y <= 3) {
      this.mesh.position.y = 3;
      this.velocity.y = 0;
      this.isGrounded = true;
    }

    this.camera.position = new BABYLON.Vector3(
      this.mesh.position.x,
      this.mesh.position.y + 1.5,
      this.mesh.position.z
    );
  }

  takeDamage(amount: number): void {
    if (this.stats.armor > 0) {
      const armorDamage = Math.min(this.stats.armor, amount * 0.7);
      this.stats.armor -= armorDamage;
      amount -= armorDamage;
    }
    this.stats.health = Math.max(0, this.stats.health - amount);
  }

  heal(amount: number): void {
    this.stats.health = Math.min(this.stats.maxHealth, this.stats.health + amount);
  }

  addArmor(amount: number): void {
    this.stats.armor = Math.min(this.stats.maxArmor, this.stats.armor + amount);
  }

  addCredits(amount: number): void {
    this.stats.credits += amount;
  }

  addExperience(amount: number): void {
    this.stats.experience += amount;
    const expNeeded = this.stats.level * 100;
    if (this.stats.experience >= expNeeded) {
      this.stats.experience -= expNeeded;
      this.stats.level++;
      this.stats.maxHealth += 10;
      this.stats.health = this.stats.maxHealth;
    }
  }

  getStats(): PlayerStats {
    return { ...this.stats };
  }

  getPosition(): BABYLON.Vector3 {
    return this.mesh.position.clone();
  }

  getMesh(): BABYLON.Mesh {
    return this.mesh;
  }
}
