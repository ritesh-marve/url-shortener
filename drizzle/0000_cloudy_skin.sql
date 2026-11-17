CREATE TABLE "links" (
	"id" uuid PRIMARY KEY NOT NULL,
	"code" varchar(255) NOT NULL,
	"destination_url" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "links_code_unique" UNIQUE("code")
);
