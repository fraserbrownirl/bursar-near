/** Custom node:test reporter. Counts tests the runner finished, not names in source. */
export default async function reporter(source) {
  let tests = 0;
  let pass = 0;
  let fail = 0;
  let cancelled = 0;
  let skipped = 0;
  let todo = 0;
  for await (const event of source) {
    const data = event.data;
    if (!data || data.details?.type === "suite") continue;
    if (event.type === "test:pass") {
      tests += 1;
      if (data.skip) skipped += 1;
      else if (data.todo) todo += 1;
      else pass += 1;
    } else if (event.type === "test:fail") {
      tests += 1;
      if (data.todo) todo += 1;
      else fail += 1;
    } else if (event.type === "test:cancel") {
      cancelled += 1;
    }
  }
  process.stdout.write(JSON.stringify({ tests, pass, fail, skipped, todo, cancelled }) + "\n");
}
