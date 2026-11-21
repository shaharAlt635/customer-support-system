/**
 * Seeds two demo companies, each with its own staff and customer accounts, categories and
 * tickets (conversations, internal notes and history spread over the last six weeks).
 *
 *   npm run db:seed            # seed an empty database
 *   npm run db:seed -- --reset # wipe everything first
 */
import {
  type Prisma,
  PrismaClient,
  type Role,
  type TicketPriority,
  type TicketStatus,
} from '@prisma/client';
import { DEFAULT_GROUPS, PRIORITY_RANK } from '@support-desk/shared';
import { hashPassword } from '../src/lib/password';
import { TICKET_NUMBER_OFFSET, setTicketCounter } from '../src/modules/tickets/ticket-number';

try {
  process.loadEnvFile();
} catch {
  // Use the process environment.
}

const prisma = new PrismaClient();
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

// Deterministic PRNG so every seed produces the same dataset.
let state = 0x5eed;
function random(): number {
  state |= 0;
  state = (state + 0x6d2b79f5) | 0;
  let t = Math.imul(state ^ (state >>> 15), 1 | state);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)]!;
const between = (min: number, max: number) => min + random() * (max - min);

interface DemoAccount {
  name: string;
  email: string;
  role: Role;
  password: string;
  /** Permission group for agents. */
  group?: string;
}

export const DEMO_ACCOUNTS: DemoAccount[] = [
  { name: 'Avery Admin', email: 'admin@example.com', role: 'OWNER', password: 'Admin123!' },
  {
    name: 'Sam Rivera',
    email: 'agent@example.com',
    role: 'AGENT',
    group: 'Agent',
    password: 'Agent123!',
  },
  {
    name: 'Jordan Lee',
    email: 'jordan.lee@example.com',
    role: 'AGENT',
    group: 'Administrator',
    password: 'Agent123!',
  },
  {
    name: 'Casey Morgan',
    email: 'customer@example.com',
    role: 'CUSTOMER',
    password: 'Customer123!',
  },
  {
    name: 'Priya Patel',
    email: 'priya.patel@example.com',
    role: 'CUSTOMER',
    password: 'Customer123!',
  },
  {
    name: 'Diego Alvarez',
    email: 'diego.alvarez@example.com',
    role: 'CUSTOMER',
    password: 'Customer123!',
  },
  { name: 'Mei Chen', email: 'mei.chen@example.com', role: 'CUSTOMER', password: 'Customer123!' },
  {
    name: 'Tom Becker',
    email: 'tom.becker@example.com',
    role: 'CUSTOMER',
    password: 'Customer123!',
  },
];

/**
 * Globex reuses some of the same emails as Acme to show that accounts are per company:
 * agent@example.com works at both, with a separate account (and password) in each.
 */
const GLOBEX_ACCOUNTS: DemoAccount[] = [
  { name: 'Hank Scorpio', email: 'admin@example.com', role: 'OWNER', password: 'Admin123!' },
  {
    name: 'Sam Rivera',
    email: 'agent@example.com',
    role: 'AGENT',
    group: 'Agent',
    password: 'Agent123!',
  },
  {
    name: 'Casey Morgan',
    email: 'customer@example.com',
    role: 'CUSTOMER',
    password: 'Customer123!',
  },
  { name: 'Homer Simpson', email: 'homer@example.com', role: 'CUSTOMER', password: 'Customer123!' },
  { name: 'Lenny Leonard', email: 'lenny@example.com', role: 'CUSTOMER', password: 'Customer123!' },
];

const CATEGORIES = [
  { name: 'Billing', color: '#22c55e', description: 'Invoices, payments, refunds and plans' },
  { name: 'Technical Support', color: '#3b82f6', description: 'Help using the product' },
  { name: 'Account & Access', color: '#a855f7', description: 'Sign-in, passwords and permissions' },
  { name: 'Bug Report', color: '#ef4444', description: 'Something is broken' },
  { name: 'Feature Request', color: '#f59e0b', description: 'Ideas and suggestions' },
  { name: 'General', color: '#64748b', description: 'Anything else' },
];

interface Template {
  category: string;
  priority: TicketPriority;
  subject: string;
  description: string;
  agentReply: string;
  customerFollowUp?: string;
  internalNote?: string;
}

const TEMPLATES: Template[] = [
  {
    category: 'Billing',
    priority: 'HIGH',
    subject: 'Charged twice for my monthly subscription',
    description:
      'I was billed twice this month for the Pro plan — both charges show on my card statement. Can you refund the duplicate?',
    agentReply:
      'Sorry about that! I can see two charges on your account. I have issued a refund for the duplicate; it should appear within 5–7 business days.',
    customerFollowUp: 'Thanks, I see the pending refund now.',
    internalNote:
      'Duplicate charge caused by a payment-provider retry. Refund ID logged in the billing tool.',
  },
  {
    category: 'Billing',
    priority: 'MEDIUM',
    subject: 'Need a VAT invoice for last quarter',
    description:
      'Our accounting team needs VAT-compliant invoices for July to September. Where can I download them?',
    agentReply:
      'You can download VAT invoices under Settings → Billing → Invoices. I have also attached a combined PDF to this ticket for convenience.',
  },
  {
    category: 'Billing',
    priority: 'LOW',
    subject: 'How do I switch to annual billing?',
    description:
      'We would like to move from monthly to annual billing to get the discount. Is that possible mid-cycle?',
    agentReply:
      'Yes! Switching mid-cycle is supported — we prorate the remaining days. Go to Settings → Billing → Change plan and choose "Annual".',
    customerFollowUp: 'Done, that was easy. Thank you!',
  },
  {
    category: 'Technical Support',
    priority: 'MEDIUM',
    subject: 'CSV export is missing the custom fields',
    description:
      'When I export contacts to CSV, the custom fields we created are not included. Is there a setting I am missing?',
    agentReply:
      'Custom fields are excluded by default. In the export dialog, tick "Include custom fields" before exporting and they will be added as extra columns.',
    customerFollowUp: 'Found it, thanks — maybe make that option more visible?',
  },
  {
    category: 'Technical Support',
    priority: 'HIGH',
    subject: 'Webhook deliveries failing with 401',
    description:
      'Since yesterday all webhook deliveries to our endpoint fail with HTTP 401. We did not change anything on our side.',
    agentReply:
      'We rotated webhook signing secrets yesterday after a security review. Please copy the new secret from Settings → Developers → Webhooks and update your endpoint.',
    internalNote:
      'Several customers affected by the secret rotation. Linking to incident INC-2291.',
  },
  {
    category: 'Technical Support',
    priority: 'LOW',
    subject: 'Question about API rate limits',
    description:
      'What are the API rate limits on the Business plan? We are planning a nightly sync job.',
    agentReply:
      'The Business plan allows 600 requests per minute per API key. For nightly syncs we recommend the bulk endpoints, which count as a single request per 1,000 records.',
  },
  {
    category: 'Account & Access',
    priority: 'URGENT',
    subject: 'Locked out of admin account before a launch',
    description:
      'Our only admin account is locked after too many sign-in attempts and we have a launch in two hours. Please help urgently!',
    agentReply:
      'I have verified your identity via the billing contact and unlocked the account. I strongly recommend adding a second admin so this cannot block you again.',
    customerFollowUp: 'We are back in. You saved our launch, thank you!',
    internalNote: 'Identity verified via phone call with the billing contact on file.',
  },
  {
    category: 'Account & Access',
    priority: 'MEDIUM',
    subject: 'Password reset email never arrives',
    description:
      'I requested a password reset three times but no email arrived. I checked my spam folder as well.',
    agentReply:
      'It looks like your mail server rejected our messages. I have whitelisted your domain on our side — please try again and let me know if it still does not arrive.',
    customerFollowUp: 'Still nothing, unfortunately.',
  },
  {
    category: 'Account & Access',
    priority: 'LOW',
    subject: 'Add a teammate with read-only access',
    description:
      'How can I invite a colleague who should only be able to view reports, not edit anything?',
    agentReply:
      'Invite them from Settings → Team and pick the "Viewer" role. Viewers can see dashboards and reports but cannot change data.',
  },
  {
    category: 'Bug Report',
    priority: 'HIGH',
    subject: 'Dashboard charts are blank in Safari',
    description:
      'Since the last update the dashboard charts no longer render in Safari 17. Chrome works fine. Console shows a ResizeObserver error.',
    agentReply:
      'Thanks for the detailed report — we reproduced it and a fix is scheduled for tomorrow’s release. As a workaround, Chrome or Firefox work normally.',
    internalNote: 'Engineering ticket ENG-4412. Regression from chart library upgrade.',
  },
  {
    category: 'Bug Report',
    priority: 'MEDIUM',
    subject: 'Dates show in the wrong time zone',
    description:
      'All timestamps in the activity log are shown in UTC even though my profile is set to Europe/Berlin.',
    agentReply:
      'Confirmed — the activity log ignores the profile time zone. Our team is working on it and I will update you once the fix is live.',
  },
  {
    category: 'Bug Report',
    priority: 'URGENT',
    subject: 'Checkout page returns a 500 error',
    description:
      'Customers cannot complete purchases — the checkout page shows "Internal Server Error". This is costing us sales!',
    agentReply:
      'We identified a faulty deployment and rolled it back. Checkout is working again; we are monitoring closely and will share a post-mortem.',
    customerFollowUp: 'Confirmed working on our side. Please send the post-mortem when ready.',
    internalNote: 'Rolled back release 2026.11.3. Incident commander: Jordan.',
  },
  {
    category: 'Feature Request',
    priority: 'LOW',
    subject: 'Dark mode for the web app',
    description: 'Our team works late shifts and would love a dark theme. Is that on the roadmap?',
    agentReply:
      'Thanks for the suggestion! Dark mode is on our roadmap for next quarter. I have added your vote to the feature request.',
  },
  {
    category: 'Feature Request',
    priority: 'MEDIUM',
    subject: 'Bulk edit tags on multiple records',
    description:
      'It would save us hours if we could select many records and add or remove tags in one go.',
    agentReply:
      'Great idea — I have shared this with the product team. Bulk actions are being designed right now, so your timing is perfect.',
  },
  {
    category: 'General',
    priority: 'LOW',
    subject: 'Do you offer discounts for non-profits?',
    description:
      'We are a registered charity. Do you offer any discount for non-profit organisations?',
    agentReply:
      'We do! Registered non-profits get 40% off any plan. Reply with a copy of your registration certificate and I will apply the discount.',
    customerFollowUp: 'Great — I have sent the certificate to the billing address.',
  },
  {
    category: 'General',
    priority: 'MEDIUM',
    subject: 'Data residency for EU customers',
    description:
      'Can we choose to store our data exclusively in the EU? This is a requirement from our legal team.',
    agentReply:
      'Yes, EU data residency is available on the Business and Enterprise plans. I can arrange a migration to our Frankfurt region — shall I schedule it?',
  },
];

const STATUS_WEIGHTS: [TicketStatus, number][] = [
  ['OPEN', 0.22],
  ['IN_PROGRESS', 0.2],
  ['WAITING_ON_CUSTOMER', 0.13],
  ['RESOLVED', 0.27],
  ['CLOSED', 0.18],
];

function pickStatus(): TicketStatus {
  let roll = random();
  for (const [status, weight] of STATUS_WEIGHTS) {
    if ((roll -= weight) <= 0) return status;
  }
  return 'OPEN';
}

async function wipe() {
  await prisma.attachment.deleteMany();
  await prisma.ticketEvent.deleteMany();
  await prisma.message.deleteMany();
  await prisma.ticket.deleteMany();
  await prisma.pendingSubmission.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.invitation.deleteMany();
  await prisma.refreshToken.deleteMany();
  await prisma.userToken.deleteMany();
  await prisma.category.deleteMany();
  await prisma.user.deleteMany();
  await prisma.permissionGroup.deleteMany();
  await prisma.counter.deleteMany();
  await prisma.devEmail.deleteMany();
  await prisma.company.deleteMany();
}

interface CompanySeed {
  name: string;
  slug: string;
  accounts: DemoAccount[];
  ticketCount: number;
  /** Pending team invitations: an existing customer and someone without an account. */
  invitations: { email: string; group: string }[];
  /** Public ticket page settings. */
  portal: Pick<
    Prisma.CompanyCreateInput,
    | 'allowAccountTickets'
    | 'allowGuestTickets'
    | 'allowAnonymousTickets'
    | 'portalTitle'
    | 'portalMessage'
    | 'brandColor'
  >;
  /** Every n-th ticket is submitted anonymously (0 = none). */
  anonymousEvery: number;
}

const COMPANIES: CompanySeed[] = [
  {
    name: 'Acme Inc.',
    slug: 'acme',
    accounts: DEMO_ACCOUNTS,
    ticketCount: 42,
    invitations: [
      { email: 'priya.patel@example.com', group: 'Agent' },
      { email: 'new.hire@example.com', group: 'Read-only' },
    ],
    portal: {
      allowAccountTickets: true,
      allowGuestTickets: true,
      allowAnonymousTickets: true,
      portalTitle: 'Hi, how can we help?',
      portalMessage:
        'Questions about billing, your account or something not working? Send us a request and our team usually replies within a few hours.',
      brandColor: '#4f46e5',
    },
    anonymousEvery: 11,
  },
  {
    name: 'Globex Corporation',
    slug: 'globex',
    accounts: GLOBEX_ACCOUNTS,
    ticketCount: 14,
    invitations: [],
    // Globex only takes requests from customer accounts.
    portal: {
      allowAccountTickets: true,
      allowGuestTickets: false,
      allowAnonymousTickets: false,
      portalTitle: 'Globex Customer Care',
      brandColor: '#0f766e',
    },
    anonymousEvery: 0,
  },
];

async function seedCompany(seed: CompanySeed) {
  const company = await prisma.company.create({
    data: { name: seed.name, slug: seed.slug, ...seed.portal },
  });
  const verifiedAt = new Date();

  const groups = await Promise.all(
    DEFAULT_GROUPS.map((group) =>
      prisma.permissionGroup.create({
        data: {
          companyId: company.id,
          name: group.name,
          description: group.description,
          permissions: [...group.permissions],
          isDefault: group.isDefault,
        },
      }),
    ),
  );
  const groupByName = new Map(groups.map((group) => [group.name, group]));

  // Accounts are per company.
  const users = await Promise.all(
    seed.accounts.map(async (account) =>
      prisma.user.create({
        data: {
          companyId: company.id,
          name: account.name,
          email: account.email,
          role: account.role,
          groupId: account.group ? (groupByName.get(account.group)?.id ?? null) : null,
          emailVerifiedAt: verifiedAt,
          passwordHash: await hashPassword(account.password),
          lastLoginAt: null,
        },
      }),
    ),
  );
  const agents = users.filter((u) => u.role === 'AGENT' || u.role === 'OWNER');
  const customers = users.filter((u) => u.role === 'CUSTOMER');

  const categories = await Promise.all(
    CATEGORIES.map((data) => prisma.category.create({ data: { ...data, companyId: company.id } })),
  );
  const categoryByName = new Map(categories.map((c) => [c.name, c]));

  const now = Date.now();
  const drafts: Prisma.TicketUncheckedCreateInput[] = [];

  for (let i = 0; i < seed.ticketCount; i++) {
    const template = TEMPLATES[i % TEMPLATES.length]!;
    const customer = pick(customers);
    const status = pickStatus();
    const priority = random() < 0.75 ? template.priority : pick(['LOW', 'MEDIUM', 'HIGH'] as const);
    const createdAt = new Date(now - between(0.2, 42) * DAY);

    const assignee = status === 'OPEN' && random() < 0.6 ? null : pick(agents);

    const messages: Prisma.MessageUncheckedCreateWithoutTicketInput[] = [];
    const events: Prisma.TicketEventUncheckedCreateWithoutTicketInput[] = [
      { type: 'CREATED', actorId: customer.id, createdAt, fromValue: null, toValue: null },
    ];
    let cursor = createdAt.getTime();
    const step = (minHours: number, maxHours: number) => {
      cursor = Math.min(cursor + between(minHours, maxHours) * HOUR, now - 5 * 60 * 1000);
      return new Date(cursor);
    };

    let currentStatus: TicketStatus = 'OPEN';
    const changeStatus = (to: TicketStatus, actorId: string, at: Date) => {
      events.push({
        type: 'STATUS_CHANGED',
        actorId,
        fromValue: currentStatus,
        toValue: to,
        createdAt: at,
      });
      currentStatus = to;
    };

    if (assignee) {
      events.push({
        type: 'ASSIGNEE_CHANGED',
        actorId: assignee.id,
        fromValue: null,
        toValue: assignee.name,
        createdAt: step(0.2, 3),
      });
    }

    let firstResponseAt: Date | null = null;
    if (assignee && status !== 'OPEN') {
      if (template.internalNote && random() < 0.7) {
        messages.push({
          authorId: assignee.id,
          body: template.internalNote,
          isInternal: true,
          createdAt: step(0.1, 1),
        });
      }
      const replyAt = step(0.3, 10);
      firstResponseAt = replyAt;
      messages.push({
        authorId: assignee.id,
        body: template.agentReply,
        isInternal: false,
        createdAt: replyAt,
      });
      changeStatus(
        status === 'WAITING_ON_CUSTOMER' ? 'WAITING_ON_CUSTOMER' : 'IN_PROGRESS',
        assignee.id,
        replyAt,
      );

      if (template.customerFollowUp && status !== 'WAITING_ON_CUSTOMER') {
        messages.push({
          authorId: customer.id,
          body: template.customerFollowUp,
          isInternal: false,
          createdAt: step(1, 20),
        });
      }
    }

    let resolvedAt: Date | null = null;
    let closedAt: Date | null = null;
    if ((status === 'RESOLVED' || status === 'CLOSED') && assignee) {
      resolvedAt = step(0.5, 12);
      changeStatus('RESOLVED', assignee.id, resolvedAt);
      if (status === 'CLOSED') {
        closedAt = step(12, 72);
        changeStatus('CLOSED', random() < 0.5 ? customer.id : assignee.id, closedAt);
      }
    }

    const lastActivityAt = new Date(
      Math.max(
        createdAt.getTime(),
        ...messages.map((m) => new Date(m.createdAt!).getTime()),
        ...events.map((e) => new Date(e.createdAt!).getTime()),
      ),
    );

    drafts.push({
      companyId: company.id,
      isAnonymous: seed.anonymousEvery > 0 && i % seed.anonymousEvery === seed.anonymousEvery - 1,
      number: 0,
      subject: template.subject,
      description: template.description,
      status,
      priority,
      priorityRank: PRIORITY_RANK[priority],
      categoryId: categoryByName.get(template.category)?.id ?? null,
      customerId: customer.id,
      assigneeId: assignee?.id ?? null,
      firstResponseAt,
      resolvedAt,
      closedAt,
      lastActivityAt,
      createdAt,
      messages: { create: messages },
      events: { create: events },
    });
  }

  // Number tickets in chronological order, like a real help desk would have.
  drafts.sort((a, b) => new Date(a.createdAt!).getTime() - new Date(b.createdAt!).getTime());
  for (const [index, draft] of drafts.entries()) {
    draft.number = TICKET_NUMBER_OFFSET + index + 1;
    await prisma.ticket.create({ data: draft });
  }
  await setTicketCounter(prisma, company.id, TICKET_NUMBER_OFFSET + drafts.length);

  // Pending invitations from the owner, plus bell notifications for invitees with accounts.
  const owner = users.find((u) => u.role === 'OWNER')!;
  for (const invite of seed.invitations) {
    await prisma.invitation.create({
      data: {
        companyId: company.id,
        email: invite.email,
        groupId: groupByName.get(invite.group)!.id,
        invitedById: owner.id,
        expiresAt: new Date(Date.now() + 14 * DAY),
        respondedAt: null,
      },
    });
    const invitee = users.find((u) => u.email === invite.email);
    if (invitee) {
      await prisma.notification.create({
        data: {
          userId: invitee.id,
          type: 'INVITATION',
          title: `${owner.name} invited you to join the ${company.name} team`,
          link: '/invitations',
          readAt: null,
        },
      });
    }
  }

  // Assignment notifications for each agent's most recent active tickets.
  const assigned = await prisma.ticket.findMany({
    where: {
      companyId: company.id,
      assigneeId: { not: null },
      status: { in: ['OPEN', 'IN_PROGRESS', 'WAITING_ON_CUSTOMER'] },
    },
    orderBy: { lastActivityAt: 'desc' },
    take: 8,
  });
  for (const [index, ticket] of assigned.entries()) {
    await prisma.notification.create({
      data: {
        userId: ticket.assigneeId!,
        type: 'TICKET_ASSIGNED',
        title: `You were assigned #${ticket.number} ${ticket.subject}`,
        link: `/tickets/${ticket.id}`,
        readAt: index < 3 ? null : ticket.lastActivityAt,
        createdAt: ticket.lastActivityAt,
      },
    });
  }

  console.log(
    `🏢 ${seed.name} (/${seed.slug}): ${users.length} users, ${categories.length} categories, ${drafts.length} tickets`,
  );
}

async function main() {
  const reset = process.argv.includes('--reset');

  if (reset) {
    console.log('🧹 Wiping existing data…');
    await wipe();
  } else if ((await prisma.company.count()) > 0) {
    console.log('ℹ️  Database already contains data. Run `npm run db:reset` to wipe and reseed.');
    return;
  }

  for (const company of COMPANIES) await seedCompany(company);

  console.log('\n✅ Done. Each company has its own accounts with these demo logins:');
  console.table(
    DEMO_ACCOUNTS.filter((a) => /^(admin|agent|customer)@/.test(a.email)).map(
      ({ role, email, password }) => ({ role, email, password }),
    ),
  );
  console.log('Sign in at http://localhost:5173/acme/login or http://localhost:5173/globex/login');
}

main()
  .catch((error) => {
    console.error('❌ Seeding failed:', error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
