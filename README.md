# SteadyGate - Vision-Based Smart Home Accessibility System

SteadyGate is an intelligent assistive technology application designed to help individuals with motor impairments (such as Parkinson's disease) control smart home appliances through real-time hand gesture recognition with tremor-compensating algorithms.

## Key Features

- **MediaPipe Hand Landmarking**: Real-time 21-point hand tracking with GPU and CPU fallback pipelines.
- **Adaptive Filtering & Smoothing**: Tremor compensation and intent tracking for reliable gesture detection.
- **Smart Appliance Actuation**: Simulates and logs actuation events for home devices (lights, thermostat, doors, etc.).
- **Calibration & Personalization**: Per-user gesture profiling and span-ratio adaptations.
- **Full-Stack Next.js & PostgreSQL**: Persisted telemetry, user profiles, actuation logs, and agent audit trails using Drizzle ORM.

## Tech Stack

- **Frontend / Framework**: Next.js 16 (Turbopack), React 19, TypeScript, Tailwind CSS
- **Vision Pipeline**: `@mediapipe/tasks-vision` (WebAssembly)
- **Database & ORM**: PostgreSQL 17, Drizzle ORM
- **Icons**: Lucide React

## Getting Started

### 1. Prerequisites

- [Node.js](https://nodejs.org/) (v18+)
- [PostgreSQL](https://www.postgresql.org/) (v15+)

### 2. Environment Setup

Create a `.env` file in the root directory (or copy from `.env.example`):

```bash
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/app_db
```

### 3. Installation

```bash
npm install
```

### 4. Database Setup

Push the Drizzle schema to your PostgreSQL database and seed initial data:

```bash
npm run db:push
npm run db:seed
```

### 5. Running the Application

```bash
npm run dev -- -p 3001
```

Open [http://localhost:3001](http://localhost:3001) in your browser.

## Available Scripts

- `npm run dev`: Runs Next.js development server
- `npm run build`: Builds the production bundle
- `npm run start`: Runs production server
- `npm run typecheck`: Runs TypeScript compiler check (`tsc --noEmit`)
- `npm run db:push`: Pushes schema changes to PostgreSQL via Drizzle Kit
- `npm run db:seed`: Seeds the database with default appliances and demo user
