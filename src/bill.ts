/** A receipt total shared by the guests named on it. Amounts are decimal dollars. */
export type Bill = { total: string; guests: number; each: string };

function cents(value: string): number {
  const [whole, frac = ""] = value.split(".");
  return Number(whole) * 100 + Number((frac + "00").slice(0, 2));
}

function money(cents: number): string {
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}

/**
 * The total and the guest count from receipt text.
 * A total on the same line as TOTAL is that figure. Otherwise it is the largest money amount.
 */
export function billShare(text: string): Bill | null {
  const guests = text.match(/\b(\d+)\s+guests\b/i);
  const count = Number(guests?.[1] ?? "");
  if (!Number.isInteger(count) || count < 2) return null;
  const inline = text.match(/\bTOTAL\b[^\n]*?(\d+\.\d{2})/i)?.[1];
  const amounts = [...text.matchAll(/\b(\d+\.\d{2})\b/g)].map((match) => match[1] ?? "");
  const total = inline ?? amounts.reduce((max, item) => cents(item) > cents(max) ? item : max, "");
  if (!total) return null;
  return { total, guests: count, each: money(Math.round(cents(total) / count)) };
}

/** One share of a total. `people` is at least 2. */
export function shareOf(total: string, people: number): string | null {
  if (!/^\d+(\.\d+)?$/.test(total) || !Number.isInteger(people) || people < 2) return null;
  return money(Math.round(cents(total) / people));
}
