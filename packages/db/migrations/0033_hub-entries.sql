-- The copy of the findable entries the search across packs reads its words in (ADR-0104), and
-- the snapshots it holds. Both tables are new and empty, so the index is built here; the copy is
-- filled by the writes of indexes and by the worker's pass, never here. Written to run twice, as
-- the migrations after 0029 are: the generator's statements, with `IF NOT EXISTS` and the
-- foreign keys inside the tables by hand.
CREATE TABLE IF NOT EXISTS "hub_snapshots" (
	"snapshot_id" uuid PRIMARY KEY NOT NULL,
	"indexed_at" timestamp with time zone NOT NULL,
	"entries" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hub_snapshots_snapshot_id_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."snapshots"("id") ON DELETE cascade ON UPDATE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "hub_entries" (
	"snapshot_id" uuid NOT NULL,
	"path" text NOT NULL,
	"search" "tsvector" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hub_entries_pkey" PRIMARY KEY("snapshot_id","path"),
	CONSTRAINT "hub_entries_snapshot_id_hub_snapshots_snapshot_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."hub_snapshots"("snapshot_id") ON DELETE cascade ON UPDATE no action
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "hub_entries_search_idx" ON "hub_entries" USING gin ("search") WITH (fastupdate=false);
