---
title: 'Prisma Schema Basics: Modeling a Content Site'
topic: full-stack
kind: lesson
level: beginner
tags:
- full-stack
- foundations
---

## What you will learn
- Write a Prisma schema with models, fields, and relations
- Understand the `@id`, `@unique`, `@default`, and `@relation` attributes
- Model one-to-many and many-to-many relationships
- Run migrations to create database tables from your schema

## Why this matters
Prisma is the most popular TypeScript ORM and the standard in Next.js full-stack apps. Interviewers expect you to model a database schema on a whiteboard in minutes. If you can't translate a product requirement into a relational model, you can't ship a real app.

## What Prisma does

Prisma is a **type-safe ORM** for Node.js and TypeScript. You define your data model in a `.prisma` schema file, and Prisma generates:
1. A migration SQL file to create/alter your database tables
2. A TypeScript client with full autocomplete for every query

## The schema file

Every Prisma project has a `prisma/schema.prisma` file. It has three sections:

```prisma
// 1. Data source — which database to connect to
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// 2. Generator — what client to generate
generator client {
  provider = "prisma-client-js"
}

// 3. Models — your data tables
model Article {
  id          String   @id @default(cuid())
  slug        String   @unique
  title       String
  body        String
  publishedAt DateTime @default(now())
  author      Author   @relation(fields: [authorId], references: [id])
  authorId    String
  tags        Tag[]
}
```

## Field types and attributes

| Attribute | Meaning |
|-----------|---------|
| `@id` | Primary key |
| `@unique` | Unique constraint (no duplicates) |
| `@default(cuid())` | Auto-generate a CUID on creation |
| `@default(now())` | Set to current timestamp on creation |
| `@relation` | Defines a foreign key relationship |
| `?` after type | Field is optional (nullable) |

## Modeling relationships

**One-to-many:** An author has many articles.

```prisma
model Author {
  id       String    @id @default(cuid())
  name     String
  email    String    @unique
  articles Article[]   // One author → many articles
}

model Article {
  id       String @id @default(cuid())
  title    String
  author   Author @relation(fields: [authorId], references: [id])
  authorId String   // Foreign key column
}
```

The `authorId` field is the actual foreign key column in the database. The `author` field is a virtual relation — Prisma uses it for joins.

**Many-to-many:** Articles can have many tags, and tags can be on many articles.

```prisma
model Article {
  id   String @id @default(cuid())
  tags Tag[]
}

model Tag {
  id       String    @id @default(cuid())
  name     String    @unique
  articles Article[]
}
```

Prisma automatically creates a join table (`_ArticleToTag`) for implicit many-to-many relations.

## Running migrations

After editing your schema, apply it to the database:

```bash
# Generate a migration SQL file and apply it
npx prisma migrate dev --name init

# Regenerate the TypeScript client
npx prisma generate
```

`migrate dev` compares your schema to the current database state, generates the SQL diff, and applies it. The `--name` flag labels the migration for your git history.

```prisma
// prisma/schema.prisma — Full content site schema
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

model Company {
  id        String    @id @default(cuid())
  name      String    @unique
  industry  String?
  layoffs   Layoff[]
  createdAt DateTime  @default(now())
}

model Layoff {
  id          String   @id @default(cuid())
  company     Company  @relation(fields: [companyId], references: [id])
  companyId   String
  headcount   Int
  percentage  Float?
  source      String
  reportedAt  DateTime
  article     Article? @relation(fields: [articleId], references: [id])
  articleId   String?
}

model Article {
  id          String   @id @default(cuid())
  slug        String   @unique
  title       String
  body        String
  publishedAt DateTime @default(now())
  layoffs     Layoff[]
  tags        Tag[]
}

model Tag {
  id       String    @id @default(cuid())
  name     String    @unique
  articles Article[]
}
```

## Try it yourself
1. In your Next.js project, install Prisma: `npm install prisma @prisma/client`
2. Initialize: `npx prisma init` — this creates `prisma/schema.prisma` and a `.env` file
3. Set `DATABASE_URL` in `.env` to a local PostgreSQL or SQLite connection
4. Copy the schema above and run `npx prisma migrate dev --name init`
5. Open Prisma Studio: `npx prisma studio` — browse your empty tables in the browser
6. Add a record manually in Studio, then query it in a Server Component with `prisma.company.findMany()`

## Common mistakes
- **Forgetting `authorId` when defining a relation** — Prisma requires both the relation field (`author`) and the scalar foreign key field (`authorId`)
- **Not running `prisma generate` after schema changes** — the TypeScript client won't know about new fields until you regenerate
- **Using `Int` for IDs in a collaborative app** — sequential integers leak information (how many records exist); prefer `cuid()` or `uuid()`
- **Skipping `@unique` on slugs** — if you use slugs in URLs, duplicates will cause routing bugs

## Checklist
- [ ] Wrote a Prisma schema with at least 3 models
- [ ] Defined one-to-many and many-to-many relationships
- [ ] Ran a migration and confirmed tables were created
- [ ] Queried data using the generated Prisma client

## Quick quiz
**Q: In a Prisma schema, you write `tags Tag[]` on the Article model and `articles Article[]` on the Tag model. What does Prisma create in the database?**

- A) A `tagId` column on the Article table
- B) An `articleId` column on the Tag table
- C) An implicit join table to represent the many-to-many relationship ✅
- D) Nothing — Prisma handles it in application code

## How to explain it in an interview
"Prisma uses a declarative schema file to define models and relationships. I write my data model once, and Prisma generates type-safe TypeScript queries and migration SQL. For a content site, I'd model entities like Article, Tag, and Author with explicit foreign keys for one-to-many relations and implicit join tables for many-to-many. The migration workflow — `prisma migrate dev` — diffs my schema against the database and generates SQL, so I never write raw DDL."
