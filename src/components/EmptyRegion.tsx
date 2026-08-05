import type { Subject } from "../domain/types";

export function EmptyRegion({ subject }: { subject: Subject }) {
  return (
    <main className="empty-region" data-testid="empty-region">
      <h1>{subject.title}</h1>
      <p>No notes here yet.</p>
    </main>
  );
}
