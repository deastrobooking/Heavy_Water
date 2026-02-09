export interface StateConfig<T extends string> {
  name: T;
  onEnter?: () => void;
  onExit?: () => void;
  onUpdate?: (dt: number) => void;
  transitions?: T[];
}

export class StateMachine<T extends string> {
  private states: Map<T, StateConfig<T>> = new Map();
  private currentState: StateConfig<T> | null = null;
  private previousState: T | null = null;
  private stateTimer: number = 0;

  addState(config: StateConfig<T>): void {
    this.states.set(config.name, config);
  }

  changeState(newState: T): boolean {
    if (this.currentState?.name === newState) return false;

    const nextState = this.states.get(newState);
    if (!nextState) return false;

    if (this.currentState?.transitions && !this.currentState.transitions.includes(newState)) {
      return false;
    }

    this.previousState = this.currentState?.name ?? null;
    this.currentState?.onExit?.();
    this.currentState = nextState;
    this.stateTimer = 0;
    this.currentState.onEnter?.();
    return true;
  }

  forceState(newState: T): void {
    const nextState = this.states.get(newState);
    if (!nextState) return;
    this.previousState = this.currentState?.name ?? null;
    this.currentState?.onExit?.();
    this.currentState = nextState;
    this.stateTimer = 0;
    this.currentState.onEnter?.();
  }

  update(dt: number): void {
    if (this.currentState) {
      this.stateTimer += dt;
      this.currentState.onUpdate?.(dt);
    }
  }

  getState(): T | null {
    return this.currentState?.name ?? null;
  }

  getPreviousState(): T | null {
    return this.previousState;
  }

  getStateTimer(): number {
    return this.stateTimer;
  }

  isInState(...states: T[]): boolean {
    return this.currentState !== null && states.includes(this.currentState.name);
  }
}
