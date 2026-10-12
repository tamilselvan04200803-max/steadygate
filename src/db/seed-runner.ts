import { seedDatabase } from "./seed";
import { pool } from "./index";

console.log("🌱 Seeding database...");
seedDatabase()
  .then(() => {
    console.log("✅ Database seeded successfully!");
    return pool.end();
  })
  .catch((err) => {
    console.error("❌ Seed failed:", err);
    process.exit(1);
  });
