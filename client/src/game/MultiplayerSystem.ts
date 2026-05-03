import * as BABYLON from "@babylonjs/core";

interface RemotePlayer {
  id: string;
  username: string;
  mesh: BABYLON.Mesh;
  nameLabel: BABYLON.Mesh;
  position: BABYLON.Vector3;
  targetPosition: BABYLON.Vector3;
  rotation: BABYLON.Vector3;
  targetRotation: BABYLON.Vector3;
  state: string;
  health: number;
  weaponId: number;
  isFlying: boolean;
  lastUpdate: number;
}

interface RoomInfo {
  code: string;
  players: number;
  maxPlayers: number;
  host: string;
  wave: number;
}

type MultiplayerCallback = (data: any) => void;

export class MultiplayerSystem {
  private scene: BABYLON.Scene;
  private ws: WebSocket | null = null;
  private playerId: string | null = null;
  private remotePlayers = new Map<string, RemotePlayer>();
  private roomCode: string | null = null;
  private isHost = false;
  private connected = false;
  private callbacks = new Map<string, MultiplayerCallback[]>();
  private sendInterval: ReturnType<typeof setInterval> | null = null;
  private rooms: RoomInfo[] = [];
  private chatMessages: { username: string; message: string; time: number }[] = [];
  private username = "";

  constructor(scene: BABYLON.Scene) {
    this.scene = scene;
  }

  connect(username: string, userId: number): void {
    // Guard against double-connect — Versus startup may race with the
    // campaign-auth connect that runs at game-init time. A second WS would
    // both leak and cause nondeterministic ordering of `connected` events
    // and join/create attempts.
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }
    this.username = username;
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/ws`;

    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      this.send({ type: "auth", username, userId });
    };

    this.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        this.handleMessage(msg);
      } catch {}
    };

    this.ws.onclose = () => {
      this.connected = false;
      this.cleanup();
      this.emit("disconnected", {});
    };

    this.ws.onerror = () => {
      this.connected = false;
    };
  }

  private handleMessage(msg: any): void {
    switch (msg.type) {
      case "auth_ok":
        this.playerId = msg.playerId;
        this.connected = true;
        this.emit("connected", { playerId: msg.playerId });
        break;

      case "room_created":
        this.roomCode = msg.roomCode;
        this.isHost = true;
        this.startPositionSync();
        this.emit("room_joined", { roomCode: msg.roomCode, isHost: true });
        break;

      case "room_joined":
        this.roomCode = msg.roomCode;
        this.isHost = msg.isHost;
        if (msg.players) {
          for (const p of msg.players) {
            this.addRemotePlayer(p);
          }
        }
        this.startPositionSync();
        this.emit("room_joined", { roomCode: msg.roomCode, isHost: msg.isHost });
        break;

      case "room_left":
        this.roomCode = null;
        this.isHost = false;
        this.stopPositionSync();
        this.clearRemotePlayers();
        this.emit("room_left", {});
        break;

      case "room_list":
        this.rooms = msg.rooms;
        this.emit("room_list", { rooms: msg.rooms });
        break;

      case "player_joined":
        this.addRemotePlayer(msg.player);
        this.emit("player_joined", { player: msg.player });
        break;

      case "player_left":
        this.removeRemotePlayer(msg.playerId);
        this.emit("player_left", { playerId: msg.playerId, username: msg.username });
        break;

      case "player_update":
        this.updateRemotePlayer(msg);
        break;

      case "player_action":
        this.emit("player_action", msg);
        break;

      case "chat_message":
        this.chatMessages.push({
          username: msg.username,
          message: msg.message,
          time: Date.now(),
        });
        if (this.chatMessages.length > 50) this.chatMessages.shift();
        this.emit("chat_message", msg);
        break;

      case "enemy_damage":
        this.emit("enemy_damage", msg);
        break;

      case "host_changed":
        if (msg.newHostId === this.playerId) {
          this.isHost = true;
          this.emit("became_host", {});
        }
        break;

      case "error":
        this.emit("error", { message: msg.message });
        break;

      case "pong":
        break;
    }
  }

  private addRemotePlayer(playerState: any): void {
    if (this.remotePlayers.has(playerState.id)) return;

    const mesh = BABYLON.MeshBuilder.CreateBox(
      `remote_${playerState.id}`,
      { width: 0.8, height: 1.8, depth: 0.6 },
      this.scene
    );

    const mat = new BABYLON.StandardMaterial(`remote_mat_${playerState.id}`, this.scene);
    mat.diffuseColor = new BABYLON.Color3(0, 0.8, 1);
    mat.emissiveColor = new BABYLON.Color3(0, 0.3, 0.5);
    mat.alpha = 0.9;
    mesh.material = mat;

    const headMesh = BABYLON.MeshBuilder.CreateSphere(
      `remote_head_${playerState.id}`,
      { diameter: 0.5 },
      this.scene
    );
    headMesh.position.y = 1.15;
    headMesh.parent = mesh;
    const headMat = new BABYLON.StandardMaterial(`remote_headmat_${playerState.id}`, this.scene);
    headMat.diffuseColor = new BABYLON.Color3(0, 0.8, 1);
    headMat.emissiveColor = new BABYLON.Color3(0, 0.4, 0.6);
    headMesh.material = headMat;

    const visorMesh = BABYLON.MeshBuilder.CreateBox(
      `remote_visor_${playerState.id}`,
      { width: 0.4, height: 0.12, depth: 0.1 },
      this.scene
    );
    visorMesh.position.y = 1.15;
    visorMesh.position.z = 0.22;
    visorMesh.parent = mesh;
    const visorMat = new BABYLON.StandardMaterial(`remote_visormat_${playerState.id}`, this.scene);
    visorMat.diffuseColor = new BABYLON.Color3(1, 0.3, 0);
    visorMat.emissiveColor = new BABYLON.Color3(1, 0.2, 0);
    visorMesh.material = visorMat;

    const nameLabel = BABYLON.MeshBuilder.CreatePlane(
      `remote_name_${playerState.id}`,
      { width: 2, height: 0.4 },
      this.scene
    );
    nameLabel.position.y = 2.2;
    nameLabel.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;
    nameLabel.parent = mesh;

    const nameTex = new BABYLON.DynamicTexture(
      `remote_nametex_${playerState.id}`,
      { width: 256, height: 64 },
      this.scene,
      false
    );
    nameTex.hasAlpha = true;
    const ctx = nameTex.getContext();
    ctx.clearRect(0, 0, 256, 64);
    ctx.font = "bold 28px Courier New";
    ctx.fillStyle = "#00ffff";
    (ctx as any).textAlign = "center";
    ctx.fillText(playerState.username || "Player", 128, 40);
    nameTex.update();

    const nameMat = new BABYLON.StandardMaterial(`remote_namemat_${playerState.id}`, this.scene);
    nameMat.diffuseTexture = nameTex;
    nameMat.emissiveColor = new BABYLON.Color3(1, 1, 1);
    nameMat.backFaceCulling = false;
    nameMat.useAlphaFromDiffuseTexture = true;
    nameLabel.material = nameMat;

    const pos = playerState.position || { x: 0, y: 1, z: 0 };
    mesh.position.set(pos.x, pos.y, pos.z);

    this.remotePlayers.set(playerState.id, {
      id: playerState.id,
      username: playerState.username,
      mesh,
      nameLabel,
      position: mesh.position.clone(),
      targetPosition: new BABYLON.Vector3(pos.x, pos.y, pos.z),
      rotation: BABYLON.Vector3.Zero(),
      targetRotation: BABYLON.Vector3.Zero(),
      state: playerState.state || "idle",
      health: playerState.health || 100,
      weaponId: playerState.weaponId || 1,
      isFlying: playerState.isFlying || false,
      lastUpdate: Date.now(),
    });
  }

  private removeRemotePlayer(playerId: string): void {
    const remote = this.remotePlayers.get(playerId);
    if (remote) {
      remote.mesh.dispose();
      remote.nameLabel.dispose();
      this.remotePlayers.delete(playerId);
    }
  }

  private updateRemotePlayer(msg: any): void {
    const remote = this.remotePlayers.get(msg.playerId);
    if (!remote) return;

    remote.targetPosition.set(msg.position.x, msg.position.y, msg.position.z);
    remote.targetRotation.set(msg.rotation.x, msg.rotation.y, msg.rotation.z);
    remote.state = msg.state;
    remote.health = msg.health;
    remote.weaponId = msg.weaponId;
    remote.isFlying = msg.isFlying;
    remote.lastUpdate = Date.now();

    const mat = remote.mesh.material as BABYLON.StandardMaterial;
    if (mat) {
      if (remote.isFlying) {
        mat.emissiveColor = new BABYLON.Color3(0.2, 0.5, 1);
      } else {
        mat.emissiveColor = new BABYLON.Color3(0, 0.3, 0.5);
      }
    }
  }

  private clearRemotePlayers(): void {
    this.remotePlayers.forEach((p) => {
      p.mesh.dispose();
      p.nameLabel.dispose();
    });
    this.remotePlayers.clear();
  }

  private startPositionSync(): void {
    this.stopPositionSync();
    this.sendInterval = setInterval(() => {
      this.emit("request_position", {});
    }, 50);
  }

  private stopPositionSync(): void {
    if (this.sendInterval) {
      clearInterval(this.sendInterval);
      this.sendInterval = null;
    }
  }

  sendPositionUpdate(position: { x: number; y: number; z: number }, rotation: { x: number; y: number; z: number }, state: string, health: number, weaponId: number, isFlying: boolean): void {
    if (!this.connected || !this.roomCode) return;
    this.send({
      type: "position_update",
      position,
      rotation,
      state,
      health,
      weaponId,
      isFlying,
    });
  }

  sendAction(action: string, data: any): void {
    if (!this.connected || !this.roomCode) return;
    this.send({ type: "action", action, data });
  }

  sendChat(message: string): void {
    if (!this.connected || !this.roomCode) return;
    this.send({ type: "chat", message });
  }

  sendEnemyDamage(enemyId: string, damage: number, damageType: string): void {
    if (!this.connected || !this.roomCode) return;
    this.send({ type: "enemy_damage", enemyId, damage, damageType });
  }

  createRoom(mode: "coop" | "versus" = "coop"): void {
    this.send({ type: "create_room", mode });
  }

  joinRoom(roomCode: string): void {
    this.send({ type: "join_room", roomCode: roomCode.toUpperCase() });
  }

  leaveRoom(): void {
    this.send({ type: "leave_room" });
  }

  listRooms(): void {
    this.send({ type: "list_rooms" });
  }

  update(deltaTime: number): void {
    const lerpFactor = Math.min(1, deltaTime * 10);
    this.remotePlayers.forEach((remote) => {
      BABYLON.Vector3.LerpToRef(remote.mesh.position, remote.targetPosition, lerpFactor, remote.mesh.position);
      remote.mesh.rotation.y = BABYLON.Scalar.Lerp(remote.mesh.rotation.y, remote.targetRotation.y, lerpFactor);
    });
  }

  private send(msg: any): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  private cleanup(): void {
    this.stopPositionSync();
    this.clearRemotePlayers();
    this.roomCode = null;
    this.isHost = false;
  }

  on(event: string, callback: MultiplayerCallback): void {
    if (!this.callbacks.has(event)) this.callbacks.set(event, []);
    this.callbacks.get(event)!.push(callback);
  }

  off(event: string, callback: MultiplayerCallback): void {
    const cbs = this.callbacks.get(event);
    if (cbs) {
      const idx = cbs.indexOf(callback);
      if (idx >= 0) cbs.splice(idx, 1);
    }
  }

  private emit(event: string, data: any): void {
    const cbs = this.callbacks.get(event);
    if (cbs) cbs.forEach((cb) => cb(data));
  }

  isConnected(): boolean { return this.connected; }
  isInRoom(): boolean { return this.roomCode !== null; }
  getRoomCode(): string | null { return this.roomCode; }
  getIsHost(): boolean { return this.isHost; }
  getPlayerId(): string | null { return this.playerId; }
  getRooms(): RoomInfo[] { return this.rooms; }
  getChatMessages(): { username: string; message: string; time: number }[] { return this.chatMessages; }
  getRemotePlayerCount(): number { return this.remotePlayers.size; }

  disconnect(): void {
    this.cleanup();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.connected = false;
    this.playerId = null;
  }

  dispose(): void {
    this.disconnect();
    this.callbacks.clear();
  }
}
