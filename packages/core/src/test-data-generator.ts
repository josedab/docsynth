// ============================================================================
// Types
// ============================================================================

export type DataFormat = 'json' | 'typescript' | 'sql';

export type DataEntityType = 'user' | 'product' | 'order' | 'address' | 'company';

export interface TestDataOptions {
  seed?: number;
  count?: number;
  format?: DataFormat;
  locale?: string;
}

export interface GeneratedUser {
  id: string;
  name: string;
  email: string;
  phone: string;
  address: GeneratedAddress;
  createdAt: string;
}

export interface GeneratedProduct {
  id: string;
  name: string;
  description: string;
  price: number;
  category: string;
  url: string;
  inStock: boolean;
}

export interface GeneratedOrder {
  id: string;
  userId: string;
  products: Array<{ productId: string; quantity: number; price: number }>;
  total: number;
  status: 'pending' | 'processing' | 'shipped' | 'delivered';
  createdAt: string;
}

export interface GeneratedAddress {
  street: string;
  city: string;
  state: string;
  zip: string;
  country: string;
}

export interface RelatedDataSet {
  users: GeneratedUser[];
  products: GeneratedProduct[];
  orders: GeneratedOrder[];
}

// ============================================================================
// Constants
// ============================================================================

const FIRST_NAMES = [
  'Alice',
  'Bob',
  'Charlie',
  'Diana',
  'Eve',
  'Frank',
  'Grace',
  'Hank',
  'Ivy',
  'Jack',
  'Karen',
  'Leo',
  'Mona',
  'Nick',
  'Olivia',
  'Paul',
];

const LAST_NAMES = [
  'Smith',
  'Johnson',
  'Williams',
  'Brown',
  'Jones',
  'Garcia',
  'Miller',
  'Davis',
  'Martinez',
  'Anderson',
  'Taylor',
  'Thomas',
  'Moore',
  'White',
];

const CITIES = [
  'New York',
  'Los Angeles',
  'Chicago',
  'Houston',
  'Phoenix',
  'Philadelphia',
  'San Antonio',
  'San Diego',
  'Dallas',
  'Austin',
  'Portland',
  'Denver',
];

const STATES = ['NY', 'CA', 'IL', 'TX', 'AZ', 'PA', 'CO', 'OR', 'WA', 'FL'];

const STREETS = [
  'Main St',
  'Oak Ave',
  'Elm St',
  'Pine Rd',
  'Maple Dr',
  'Cedar Ln',
  'Broadway',
  'Park Ave',
  'Market St',
  'Highland Blvd',
];

const PRODUCT_ADJECTIVES = [
  'Premium',
  'Deluxe',
  'Essential',
  'Pro',
  'Ultra',
  'Classic',
  'Modern',
  'Smart',
];
const PRODUCT_NOUNS = ['Widget', 'Gadget', 'Tool', 'Kit', 'Device', 'System', 'Module', 'Pack'];
const CATEGORIES = ['Electronics', 'Software', 'Hardware', 'Accessories', 'Services', 'Books'];

const DOMAINS = ['example.com', 'test.org', 'demo.net', 'sample.io'];

const ORDER_STATUSES: GeneratedOrder['status'][] = [
  'pending',
  'processing',
  'shipped',
  'delivered',
];

// ============================================================================
// Public Functions
// ============================================================================

/** Create a seeded pseudo-random number generator. */
export function createRng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

/** Generate a UUID-like string from a seeded RNG. */
export function generateUuid(rng: () => number): string {
  const hex = () => Math.floor(rng() * 16).toString(16);
  const seg = (len: number) => Array.from({ length: len }, hex).join('');
  return `${seg(8)}-${seg(4)}-4${seg(3)}-${seg(4)}-${seg(12)}`;
}

/** Generate a realistic date string within the past year. */
export function generateDate(rng: () => number): string {
  const now = Date.now();
  const oneYear = 365 * 24 * 60 * 60 * 1000;
  const d = new Date(now - Math.floor(rng() * oneYear));
  return d.toISOString();
}

/** Generate a random email address. */
export function generateEmail(name: string, rng: () => number): string {
  const domain = pick(DOMAINS, rng);
  const slug = name.toLowerCase().replace(/\s+/g, '.') + Math.floor(rng() * 100);
  return `${slug}@${domain}`;
}

/** Generate a random phone number string. */
export function generatePhone(rng: () => number): string {
  const area = 200 + Math.floor(rng() * 800);
  const mid = 200 + Math.floor(rng() * 800);
  const end = 1000 + Math.floor(rng() * 9000);
  return `+1-${area}-${mid}-${end}`;
}

/** Generate a random URL. */
export function generateUrl(rng: () => number): string {
  const domain = pick(DOMAINS, rng);
  const path = pick(['products', 'items', 'catalog', 'shop'], rng);
  const id = Math.floor(rng() * 10000);
  return `https://${domain}/${path}/${id}`;
}

/** Generate a single user object. */
export function generateUser(rng: () => number): GeneratedUser {
  const first = pick(FIRST_NAMES, rng);
  const last = pick(LAST_NAMES, rng);
  const name = `${first} ${last}`;
  return {
    id: generateUuid(rng),
    name,
    email: generateEmail(name, rng),
    phone: generatePhone(rng),
    address: generateAddress(rng),
    createdAt: generateDate(rng),
  };
}

/** Generate a single product object. */
export function generateProduct(rng: () => number): GeneratedProduct {
  const adj = pick(PRODUCT_ADJECTIVES, rng);
  const noun = pick(PRODUCT_NOUNS, rng);
  return {
    id: generateUuid(rng),
    name: `${adj} ${noun}`,
    description: `A high-quality ${adj.toLowerCase()} ${noun.toLowerCase()} for professionals.`,
    price: Math.round(rng() * 500 * 100) / 100,
    category: pick(CATEGORIES, rng),
    url: generateUrl(rng),
    inStock: rng() > 0.2,
  };
}

/** Generate a single order referencing existing users/products. */
export function generateOrder(
  rng: () => number,
  userId: string,
  products: GeneratedProduct[]
): GeneratedOrder {
  const itemCount = 1 + Math.floor(rng() * 3);
  const items: GeneratedOrder['products'] = [];
  for (let i = 0; i < itemCount; i++) {
    const prod = pick(products, rng);
    const qty = 1 + Math.floor(rng() * 4);
    items.push({ productId: prod.id, quantity: qty, price: prod.price });
  }
  const total = Math.round(items.reduce((sum, it) => sum + it.price * it.quantity, 0) * 100) / 100;
  return {
    id: generateUuid(rng),
    userId,
    products: items,
    total,
    status: pick(ORDER_STATUSES, rng),
    createdAt: generateDate(rng),
  };
}

/** Generate a consistent related data set with users, products, and orders. */
export function generateRelatedDataSet(options: TestDataOptions = {}): RelatedDataSet {
  const rng = createRng(options.seed ?? 42);
  const count = options.count ?? 5;

  const users = Array.from({ length: count }, () => generateUser(rng));
  const products = Array.from({ length: count * 2 }, () => generateProduct(rng));
  const orders = users.flatMap((u) => {
    const orderCount = 1 + Math.floor(rng() * 3);
    return Array.from({ length: orderCount }, () => generateOrder(rng, u.id, products));
  });

  return { users, products, orders };
}

/** Format data set into the requested output format. */
export function formatDataSet(data: RelatedDataSet, format: DataFormat = 'json'): string {
  switch (format) {
    case 'json':
      return JSON.stringify(data, null, 2);
    case 'typescript':
      return formatAsTypeScript(data);
    case 'sql':
      return formatAsSql(data);
  }
}

// ============================================================================
// Internal Helpers
// ============================================================================

function generateAddress(rng: () => number): GeneratedAddress {
  return {
    street: `${100 + Math.floor(rng() * 9900)} ${pick(STREETS, rng)}`,
    city: pick(CITIES, rng),
    state: pick(STATES, rng),
    zip: String(10000 + Math.floor(rng() * 90000)),
    country: 'US',
  };
}

function pick<T>(arr: readonly T[], rng: () => number): T {
  return arr[Math.floor(rng() * arr.length)]!;
}

function sqlEscape(val: unknown): string {
  if (val === null || val === undefined) return 'NULL';
  if (typeof val === 'number') return String(val);
  if (typeof val === 'boolean') return val ? '1' : '0';
  return `'${String(val).replace(/'/g, "''")}'`;
}

function formatAsTypeScript(data: RelatedDataSet): string {
  const lines: string[] = [];
  lines.push(`export const users = ${JSON.stringify(data.users, null, 2)} as const;\n`);
  lines.push(`export const products = ${JSON.stringify(data.products, null, 2)} as const;\n`);
  lines.push(`export const orders = ${JSON.stringify(data.orders, null, 2)} as const;`);
  return lines.join('\n');
}

function formatAsSql(data: RelatedDataSet): string {
  const lines: string[] = [];

  lines.push('-- Users');
  for (const u of data.users) {
    lines.push(
      `INSERT INTO users (id, name, email, phone, created_at) VALUES (${sqlEscape(u.id)}, ${sqlEscape(u.name)}, ${sqlEscape(u.email)}, ${sqlEscape(u.phone)}, ${sqlEscape(u.createdAt)});`
    );
  }

  lines.push('\n-- Products');
  for (const p of data.products) {
    lines.push(
      `INSERT INTO products (id, name, description, price, category, in_stock) VALUES (${sqlEscape(p.id)}, ${sqlEscape(p.name)}, ${sqlEscape(p.description)}, ${sqlEscape(p.price)}, ${sqlEscape(p.category)}, ${sqlEscape(p.inStock)});`
    );
  }

  lines.push('\n-- Orders');
  for (const o of data.orders) {
    lines.push(
      `INSERT INTO orders (id, user_id, total, status, created_at) VALUES (${sqlEscape(o.id)}, ${sqlEscape(o.userId)}, ${sqlEscape(o.total)}, ${sqlEscape(o.status)}, ${sqlEscape(o.createdAt)});`
    );
  }

  return lines.join('\n');
}
