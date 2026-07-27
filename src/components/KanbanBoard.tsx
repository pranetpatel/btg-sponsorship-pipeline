"use client";

import { useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { STATUSES, STATUS_META, money } from "@/lib/constants";
import type { SponsorStatus, SponsorWithStats } from "@/lib/types";
import SponsorCard from "./SponsorCard";

export default function KanbanBoard({
  sponsors,
  selected,
  onToggle,
  onOpen,
  onStatusChange,
}: {
  sponsors: SponsorWithStats[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  onOpen: (id: string) => void;
  onStatusChange: (id: string, status: SponsorStatus) => void;
}) {
  const [activeId, setActiveId] = useState<string | null>(null);

  // A small distance threshold means a click on the checkbox or the name
  // still registers as a click rather than starting a drag.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  function handleStart(e: DragStartEvent) {
    setActiveId(String(e.active.id));
    document.body.classList.add("btg-dragging");
  }

  function handleEnd(e: DragEndEvent) {
    setActiveId(null);
    document.body.classList.remove("btg-dragging");

    const overId = e.over?.id;
    if (!overId) return;

    const status = String(overId) as SponsorStatus;
    if (!STATUSES.includes(status)) return;

    const sponsor = sponsors.find((s) => s.id === String(e.active.id));
    if (!sponsor || sponsor.status === status) return;

    onStatusChange(sponsor.id, status);
  }

  const active = sponsors.find((s) => s.id === activeId);

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleStart}
      onDragEnd={handleEnd}
      onDragCancel={() => {
        setActiveId(null);
        document.body.classList.remove("btg-dragging");
      }}
    >
      <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-5">
        {STATUSES.map((status) => (
          <Column
            key={status}
            status={status}
            sponsors={sponsors.filter((s) => s.status === status)}
            selected={selected}
            onToggle={onToggle}
            onOpen={onOpen}
          />
        ))}
      </div>

      <DragOverlay>
        {active ? (
          <div className="w-72">
            <SponsorCard
              sponsor={active}
              selected={selected.has(active.id)}
              onToggle={() => {}}
              onOpen={() => {}}
              dragging
            />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

function Column({
  status,
  sponsors,
  selected,
  onToggle,
  onOpen,
}: {
  status: SponsorStatus;
  sponsors: SponsorWithStats[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  onOpen: (id: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  const meta = STATUS_META[status];
  const total = sponsors.reduce(
    (sum, s) => sum + Number(s.potential_value ?? 0),
    0,
  );

  return (
    <div
      ref={setNodeRef}
      className={`flex min-h-[24rem] flex-col rounded-xl border-2 border-dashed p-2.5 transition-colors ${
        isOver ? `${meta.column} bg-white` : "border-cream-dark bg-cream-dark/25"
      }`}
    >
      <div className="mb-2.5 flex items-center justify-between px-1">
        <div className="flex items-center gap-2">
          <span className={`h-2 w-2 rounded-full ${meta.dot}`} />
          <h3 className="text-sm font-semibold text-purple-800">{meta.label}</h3>
          <span className="rounded-full bg-white px-1.5 text-xs font-medium tabular-nums text-purple-900/60">
            {sponsors.length}
          </span>
        </div>
        {total > 0 && (
          <span className="text-xs font-medium tabular-nums text-purple-900/45">
            {money(total)}
          </span>
        )}
      </div>

      <div className="flex-1 space-y-2 overflow-y-auto">
        {sponsors.map((sponsor) => (
          <DraggableCard
            key={sponsor.id}
            sponsor={sponsor}
            selected={selected.has(sponsor.id)}
            onToggle={() => onToggle(sponsor.id)}
            onOpen={() => onOpen(sponsor.id)}
          />
        ))}

        {!sponsors.length && (
          <p className="px-1 py-6 text-center text-xs text-purple-900/35">
            {isOver ? "Drop here" : "Nothing here yet"}
          </p>
        )}
      </div>
    </div>
  );
}

function DraggableCard({
  sponsor,
  selected,
  onToggle,
  onOpen,
}: {
  sponsor: SponsorWithStats;
  selected: boolean;
  onToggle: () => void;
  onOpen: () => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: sponsor.id,
  });

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={`cursor-grab active:cursor-grabbing ${isDragging ? "opacity-30" : ""}`}
    >
      <SponsorCard
        sponsor={sponsor}
        selected={selected}
        onToggle={onToggle}
        onOpen={onOpen}
      />
    </div>
  );
}
