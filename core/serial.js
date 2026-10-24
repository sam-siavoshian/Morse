// One-at-a-time queues for read-modify-write storage updates. Two requests
// that both read the history, add a prompt and write it back would otherwise
// interleave, and the second write would drop the first one's prompt.
//
//   const run = serialQueue();
//   run("history.json", async () => { const all = await read(); ...; await write(all); });
//
// Jobs with the same key run in the order they were queued; a failed job
// rejects its own promise and the queue moves on.

export function serialQueue() {
  const tails = new Map();
  return function run(key, job) {
    const result = (tails.get(key) || Promise.resolve()).then(() => job());
    const tail = result.then(() => {}, () => {});
    tails.set(key, tail);
    tail.then(() => { if (tails.get(key) === tail) tails.delete(key); });
    return result;
  };
}
