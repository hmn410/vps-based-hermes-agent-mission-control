import { PrismaClient } from '@prisma/client'
import * as fs from 'fs'
import * as path from 'path'

const prisma = new PrismaClient()
const DATA_DIR = './data'

function readJson(filename: string): unknown {
  const p = path.join(DATA_DIR, filename)
  if (!fs.existsSync(p)) { console.warn(`⚠️  Missing: ${filename}`); return null }
  return JSON.parse(fs.readFileSync(p, 'utf-8'))
}

function safeDate(val: unknown, fallback = new Date()): Date {
  if (!val) return fallback
  const d = new Date(val as string)
  return isNaN(d.getTime()) ? fallback : d
}

async function seedIdeas() {
  const raw = readJson('ideas.json') as any[]
  if (!raw) return
  console.log(`💡 Seeding ${raw.length} ideas...`)

  for (const d of raw) {
    await prisma.idea.upsert({
      where: { id: d.id },
      update: {},
      create: {
        id: d.id,
        title: d.title ?? '',
        description: d.description ?? null,
        category: d.category ?? null,
        type: d.type ?? null,
        model: d.model ?? null,
        status: d.status ?? null,
        timestamp: safeDate(d.timestamp),
      },
    })
  }
  console.log(`  ✅ ${raw.length} ideas done`)
}

async function seedAgentState() {
  const raw = readJson('agent-state.json') as any[]
  if (!raw) return
  console.log(`🤖 Seeding ${raw.length} agent states...`)

  for (const d of raw) {
    await prisma.agentState.upsert({
      where: { id: d.id },
      update: {
        name: d.name,
        emoji: d.emoji ?? null,
        role: d.role ?? null,
        status: d.status ?? 'offline',
        lastActive: d.lastActive ? safeDate(d.lastActive) : null,
        tasksCompleted: d.tasksCompleted ?? 0,
        totalCost: d.totalCost ?? 0,
        currentTask: d.currentTask ?? null,
        recentActivity: d.recentActivity ?? [],
        updatedAt: new Date(),
      },
      create: {
        id: d.id,
        name: d.name,
        emoji: d.emoji ?? null,
        role: d.role ?? null,
        status: d.status ?? 'offline',
        lastActive: d.lastActive ? safeDate(d.lastActive) : null,
        tasksCompleted: d.tasksCompleted ?? 0,
        totalCost: d.totalCost ?? 0,
        currentTask: d.currentTask ?? null,
        recentActivity: d.recentActivity ?? [],
        updatedAt: new Date(),
      },
    })
  }
  console.log(`  ✅ ${raw.length} agent states done`)
}

async function main() {
  console.log('🌱 Starting Max HQ data seed...\n')

  await seedAgentState()
  await seedIdeas()

  console.log('\n✅ All done! Max HQ database is fully seeded.')
}

main()
  .catch((e) => { console.error('❌ Seed failed:', e); process.exit(1) })
  .finally(() => prisma.$disconnect())
