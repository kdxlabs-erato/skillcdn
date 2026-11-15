-- The bodies some of whose sections have vectors and the rest none yet (ADR-0107). New and empty:
-- rows are written when a commit is indexed and dropped by the worker. Written to run twice, as
-- the migrations after 0029 are: the generator's statement, with `IF NOT EXISTS` by hand.
CREATE TABLE IF NOT EXISTS "unfinished_bodies" (
	"blob_sha" text NOT NULL,
	"model" text NOT NULL,
	"dimensions" integer NOT NULL,
	"sectioning_version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "unfinished_bodies_pkey" PRIMARY KEY("blob_sha","model","dimensions","sectioning_version")
);
