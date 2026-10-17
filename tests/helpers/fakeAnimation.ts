// jsdom has no Web Animations API. installFakeAnimate() stubs Element.prototype.animate with a recorder whose
// animations finish only when finish() is called, so finale tests are exact and need no timers.
//
// By default a finish or cancel listener runs inside finish() / cancel(), which keeps most tests short. A browser does not do
// that: playState changes at once, but the `finish` and `cancel` events arrive later, on the next frame. installFakeAnimate({
// deferEvents: true }) models that, and the test plays the frame itself with flushEvents().
export class FakeAnimation {
  playState: 'running' | 'finished' | 'idle' = 'running';
  private finishListeners: (() => void)[] = [];
  private cancelListeners: (() => void)[] = [];
  constructor(
    readonly target: Element,
    readonly keyframes: Keyframe[],
    readonly options: KeyframeAnimationOptions,
    private readonly deliver: (fire: () => void) => void = (fire) => fire(),
  ) {}
  finish(): void {
    if (this.playState !== 'running') return;
    this.playState = 'finished';
    for (const l of this.finishListeners) this.deliver(l);
  }
  cancel(): void {
    if (this.playState !== 'running') return;
    this.playState = 'idle';
    for (const l of this.cancelListeners) this.deliver(l);
  }
  addEventListener(type: string, cb: () => void): void {
    if (type === 'finish') this.finishListeners.push(cb);
    if (type === 'cancel') this.cancelListeners.push(cb);
  }
  removeEventListener(): void {}
}

export interface FakeAnimate {
  created: FakeAnimation[];
  /** deferEvents only: delivers every finish / cancel event that has been queued since the last call, oldest first. */
  flushEvents(): void;
  restore(): void;
}

export function installFakeAnimate(opts: { deferEvents?: boolean } = {}): FakeAnimate {
  const proto = Element.prototype as unknown as { animate?: unknown };
  const had = Object.prototype.hasOwnProperty.call(proto, 'animate');
  const previous = proto.animate;
  const created: FakeAnimation[] = [];
  const queue: (() => void)[] = [];
  const deliver = opts.deferEvents
    ? (fire: () => void): void => {
        queue.push(fire);
      }
    : (fire: () => void): void => fire();
  proto.animate = function (this: Element, keyframes: Keyframe[], options: KeyframeAnimationOptions) {
    const a = new FakeAnimation(this, keyframes, options, deliver);
    created.push(a);
    return a as unknown as Animation;
  };
  return {
    created,
    flushEvents() {
      while (queue.length > 0) queue.shift()!();
    },
    restore() {
      if (had) proto.animate = previous;
      else delete proto.animate;
    },
  };
}
