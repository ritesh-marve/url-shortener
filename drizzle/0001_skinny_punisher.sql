CREATE TABLE "click_events" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"link_id" uuid NOT NULL,
	"clicked_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "click_events" ADD CONSTRAINT "click_events_link_id_links_id_fk" FOREIGN KEY ("link_id") REFERENCES "public"."links"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "click_events_link_clicked_idx" ON "click_events" USING btree ("link_id","clicked_at");