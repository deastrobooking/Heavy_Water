import * as BABYLON from "@babylonjs/core";

export type EnemyType = "drone" | "soldier" | "heavy" | "insectoid" | "hybrid";

export interface Enemy {
  mesh: BABYLON.Mesh;
  type: EnemyType;
  health: number;
  maxHealth: number;
  damage: number;
  speed: number;
  attackRange: number;
  attackCooldown: number;
  lastAttackTime: number;
  credits: number;
  experience: number;
}

export class EnemySystem {
  private scene: BABYLON.Scene;
  private enemies: Enemy[] = [];
  private spawnTimer: number = 0;
  private spawnInterval: number = 5000;
  private maxEnemies: number = 20;
  private waveNumber: number = 1;

  constructor(scene: BABYLON.Scene) {
    this.scene = scene;
  }

  private createEnemyMesh(type: EnemyType, position: BABYLON.Vector3): BABYLON.Mesh {
    let mesh: BABYLON.Mesh;
    let color: BABYLON.Color3;
    let glowColor: BABYLON.Color3;

    switch (type) {
      case "drone":
        mesh = BABYLON.MeshBuilder.CreateSphere("drone", { diameter: 1 }, this.scene);
        color = new BABYLON.Color3(0.3, 0.3, 0.4);
        glowColor = new BABYLON.Color3(1, 0, 0);
        break;
      case "soldier":
        mesh = BABYLON.MeshBuilder.CreateCapsule("soldier", { height: 2, radius: 0.4 }, this.scene);
        color = new BABYLON.Color3(0.2, 0.25, 0.3);
        glowColor = new BABYLON.Color3(1, 0.5, 0);
        break;
      case "heavy":
        mesh = BABYLON.MeshBuilder.CreateBox("heavy", { width: 1.5, height: 2.5, depth: 1.5 }, this.scene);
        color = new BABYLON.Color3(0.4, 0.2, 0.2);
        glowColor = new BABYLON.Color3(1, 0, 0.5);
        break;
      case "insectoid":
        mesh = this.createInsectoidMesh();
        color = new BABYLON.Color3(0.3, 0.4, 0.2);
        glowColor = new BABYLON.Color3(0.5, 1, 0);
        break;
      case "hybrid":
        mesh = this.createHybridMesh();
        color = new BABYLON.Color3(0.4, 0.3, 0.4);
        glowColor = new BABYLON.Color3(0.8, 0, 1);
        break;
      default:
        mesh = BABYLON.MeshBuilder.CreateSphere("enemy", { diameter: 1 }, this.scene);
        color = new BABYLON.Color3(0.5, 0.5, 0.5);
        glowColor = new BABYLON.Color3(1, 1, 1);
    }

    mesh.position = position;
    
    const material = new BABYLON.StandardMaterial(`enemyMat_${type}`, this.scene);
    material.diffuseColor = color;
    material.emissiveColor = glowColor.scale(0.3);
    material.specularColor = new BABYLON.Color3(0.5, 0.5, 0.5);
    mesh.material = material;

    return mesh;
  }

  private createInsectoidMesh(): BABYLON.Mesh {
    const body = BABYLON.MeshBuilder.CreateSphere("insectBody", { diameter: 1.2 }, this.scene);
    
    const head = BABYLON.MeshBuilder.CreateSphere("insectHead", { diameter: 0.6 }, this.scene);
    head.position = new BABYLON.Vector3(0, 0.3, 0.5);
    head.parent = body;

    for (let i = 0; i < 6; i++) {
      const leg = BABYLON.MeshBuilder.CreateCylinder("leg", { height: 1, diameter: 0.1 }, this.scene);
      const angle = ((i % 3) - 1) * 0.5;
      const side = i < 3 ? 1 : -1;
      leg.position = new BABYLON.Vector3(side * 0.5, -0.3, angle);
      leg.rotation = new BABYLON.Vector3(0, 0, side * 0.5);
      leg.parent = body;
    }

    return body;
  }

  private createHybridMesh(): BABYLON.Mesh {
    const body = BABYLON.MeshBuilder.CreateCapsule("hybridBody", { height: 2.2, radius: 0.5 }, this.scene);
    
    const head = BABYLON.MeshBuilder.CreateSphere("hybridHead", { diameter: 0.7 }, this.scene);
    head.position = new BABYLON.Vector3(0, 1.2, 0);
    head.parent = body;

    const backPlate = BABYLON.MeshBuilder.CreateBox("backPlate", { width: 0.8, height: 1.5, depth: 0.3 }, this.scene);
    backPlate.position = new BABYLON.Vector3(0, 0.3, -0.4);
    backPlate.parent = body;

    return body;
  }

  spawnEnemy(playerPosition: BABYLON.Vector3): void {
    if (this.enemies.length >= this.maxEnemies) return;

    const angle = Math.random() * Math.PI * 2;
    const distance = 30 + Math.random() * 50;
    const x = playerPosition.x + Math.cos(angle) * distance;
    const z = playerPosition.z + Math.sin(angle) * distance;
    const position = new BABYLON.Vector3(x, 1.5, z);

    const types: EnemyType[] = ["drone", "soldier", "heavy", "insectoid", "hybrid"];
    const weights = [30, 25, 15, 20, 10];
    const totalWeight = weights.reduce((a, b) => a + b, 0);
    let random = Math.random() * totalWeight;
    let type: EnemyType = "drone";
    
    for (let i = 0; i < types.length; i++) {
      random -= weights[i];
      if (random <= 0) {
        type = types[i];
        break;
      }
    }

    const mesh = this.createEnemyMesh(type, position);
    const waveMultiplier = 1 + (this.waveNumber - 1) * 0.2;

    const enemyStats: Record<EnemyType, Omit<Enemy, "mesh" | "type" | "lastAttackTime">> = {
      drone: { health: 30, maxHealth: 30, damage: 5, speed: 0.15, attackRange: 15, attackCooldown: 1000, credits: 10, experience: 5 },
      soldier: { health: 60, maxHealth: 60, damage: 10, speed: 0.1, attackRange: 25, attackCooldown: 1500, credits: 20, experience: 10 },
      heavy: { health: 150, maxHealth: 150, damage: 25, speed: 0.05, attackRange: 10, attackCooldown: 2500, credits: 50, experience: 25 },
      insectoid: { health: 80, maxHealth: 80, damage: 15, speed: 0.12, attackRange: 5, attackCooldown: 800, credits: 30, experience: 15 },
      hybrid: { health: 200, maxHealth: 200, damage: 30, speed: 0.08, attackRange: 20, attackCooldown: 2000, credits: 100, experience: 50 },
    };

    const stats = enemyStats[type];
    const enemy: Enemy = {
      mesh,
      type,
      health: stats.health * waveMultiplier,
      maxHealth: stats.maxHealth * waveMultiplier,
      damage: stats.damage * waveMultiplier,
      speed: stats.speed,
      attackRange: stats.attackRange,
      attackCooldown: stats.attackCooldown,
      lastAttackTime: 0,
      credits: Math.floor(stats.credits * waveMultiplier),
      experience: Math.floor(stats.experience * waveMultiplier),
    };

    this.enemies.push(enemy);
  }

  update(playerPosition: BABYLON.Vector3, deltaTime: number): { damage: number; hits: Enemy[] } {
    this.spawnTimer += deltaTime;
    if (this.spawnTimer >= this.spawnInterval) {
      this.spawnTimer = 0;
      this.spawnEnemy(playerPosition);
    }

    let totalDamage = 0;
    const attackingEnemies: Enemy[] = [];
    const now = Date.now();

    for (const enemy of this.enemies) {
      const direction = playerPosition.subtract(enemy.mesh.position);
      const distance = direction.length();
      
      if (distance > enemy.attackRange) {
        direction.normalize();
        enemy.mesh.position.addInPlace(direction.scale(enemy.speed));
        enemy.mesh.lookAt(playerPosition);
      } else {
        if (now - enemy.lastAttackTime >= enemy.attackCooldown) {
          enemy.lastAttackTime = now;
          totalDamage += enemy.damage;
          attackingEnemies.push(enemy);
          
          this.createAttackEffect(enemy);
        }
      }

      enemy.mesh.position.y = 1.5 + Math.sin(now * 0.003 + enemy.mesh.position.x) * 0.1;
    }

    return { damage: totalDamage, hits: attackingEnemies };
  }

  private createAttackEffect(enemy: Enemy): void {
    const effect = BABYLON.MeshBuilder.CreateSphere("attackEffect", { diameter: 0.5 }, this.scene);
    effect.position = enemy.mesh.position.clone();
    
    const mat = new BABYLON.StandardMaterial("effectMat", this.scene);
    mat.emissiveColor = new BABYLON.Color3(1, 0, 0);
    mat.alpha = 0.8;
    effect.material = mat;

    let frame = 0;
    const animate = () => {
      frame++;
      effect.scaling = new BABYLON.Vector3(1 + frame * 0.2, 1 + frame * 0.2, 1 + frame * 0.2);
      mat.alpha = Math.max(0, 0.8 - frame * 0.1);
      if (frame < 8) {
        requestAnimationFrame(animate);
      } else {
        effect.dispose();
      }
    };
    animate();
  }

  damageEnemy(mesh: BABYLON.Mesh, damage: number): { killed: boolean; credits: number; experience: number } {
    const enemy = this.enemies.find((e) => e.mesh === mesh);
    if (!enemy) return { killed: false, credits: 0, experience: 0 };

    enemy.health -= damage;

    const flashMat = enemy.mesh.material as BABYLON.StandardMaterial;
    const originalEmissive = flashMat.emissiveColor.clone();
    flashMat.emissiveColor = new BABYLON.Color3(1, 1, 1);
    setTimeout(() => {
      if (flashMat) flashMat.emissiveColor = originalEmissive;
    }, 100);

    if (enemy.health <= 0) {
      this.createDeathEffect(enemy.mesh.position);
      enemy.mesh.dispose();
      this.enemies = this.enemies.filter((e) => e !== enemy);
      return { killed: true, credits: enemy.credits, experience: enemy.experience };
    }

    return { killed: false, credits: 0, experience: 0 };
  }

  private createDeathEffect(position: BABYLON.Vector3): void {
    for (let i = 0; i < 10; i++) {
      const particle = BABYLON.MeshBuilder.CreateBox("particle", { size: 0.2 }, this.scene);
      particle.position = position.clone();
      
      const mat = new BABYLON.StandardMaterial("particleMat", this.scene);
      mat.emissiveColor = new BABYLON.Color3(1, 0.5, 0);
      particle.material = mat;

      const velocity = new BABYLON.Vector3(
        (Math.random() - 0.5) * 0.3,
        Math.random() * 0.3,
        (Math.random() - 0.5) * 0.3
      );

      let frame = 0;
      const animate = () => {
        frame++;
        particle.position.addInPlace(velocity);
        velocity.y -= 0.01;
        particle.rotation.addInPlace(new BABYLON.Vector3(0.1, 0.1, 0.1));
        mat.alpha = Math.max(0, 1 - frame * 0.05);
        
        if (frame < 20) {
          requestAnimationFrame(animate);
        } else {
          particle.dispose();
        }
      };
      animate();
    }
  }

  getEnemyMeshes(): BABYLON.Mesh[] {
    return this.enemies.map((e) => e.mesh);
  }

  getEnemyCount(): number {
    return this.enemies.length;
  }

  nextWave(): void {
    this.waveNumber++;
    this.spawnInterval = Math.max(2000, this.spawnInterval - 200);
    this.maxEnemies = Math.min(50, this.maxEnemies + 2);
  }

  getWaveNumber(): number {
    return this.waveNumber;
  }
}
