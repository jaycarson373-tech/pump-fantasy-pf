type PFDisposableResource = {
  [Symbol.dispose]?: () => void;
};

type PFDisposableStackLike = PFDisposableResource & {
  defer(onDispose: () => void): void;
  use<T extends PFDisposableResource | null | undefined>(value: T): T;
  adopt<T>(value: T, onDispose: (value: T) => void): T;
  dispose(): void;
  readonly disposed: boolean;
};

type RuntimeWithDisposableStack = typeof globalThis & {
  DisposableStack?: new () => PFDisposableStackLike;
};

const runtime = globalThis as RuntimeWithDisposableStack;

if (typeof runtime.DisposableStack === "undefined") {
  class DisposableStackPolyfill implements PFDisposableStackLike {
    private callbacks: Array<() => void> = [];
    private isDisposed = false;

    get disposed() {
      return this.isDisposed;
    }

    defer(onDispose: () => void) {
      if (this.isDisposed) throw new ReferenceError("DisposableStack is disposed");
      if (typeof onDispose !== "function") throw new TypeError("Expected a cleanup function");
      this.callbacks.push(onDispose);
    }

    use<T extends PFDisposableResource | null | undefined>(value: T): T {
      if (value == null) return value;
      const onDispose = value[Symbol.dispose];
      if (onDispose !== undefined) {
        if (typeof onDispose !== "function") throw new TypeError("Expected a disposable value");
        this.defer(() => onDispose.call(value));
      }
      return value;
    }

    adopt<T>(value: T, onDispose: (value: T) => void): T {
      if (typeof onDispose !== "function") throw new TypeError("Expected a cleanup function");
      this.defer(() => onDispose(value));
      return value;
    }

    dispose() {
      if (this.isDisposed) return;
      this.isDisposed = true;
      let firstError: unknown;
      for (const onDispose of this.callbacks.reverse()) {
        try {
          onDispose();
        } catch (error) {
          firstError ??= error;
        }
      }
      this.callbacks = [];
      if (firstError !== undefined) throw firstError;
    }

    [Symbol.dispose]() {
      this.dispose();
    }
  }

  Object.defineProperty(runtime, "DisposableStack", {
    configurable: true,
    value: DisposableStackPolyfill,
  });
}
