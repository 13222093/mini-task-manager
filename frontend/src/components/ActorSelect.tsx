import { ACTORS, type Actor } from "@task-manager/shared";

interface Props {
  value: Actor;
  onChange: (actor: Actor) => void;
}

export function ActorSelect({ value, onChange }: Props) {
  return (
    <label className="actor-select">
      Acting as{" "}
      <select value={value} onChange={(event) => onChange(event.target.value as Actor)}>
        {ACTORS.map((actor) => (
          <option key={actor} value={actor}>
            {actor}
          </option>
        ))}
      </select>
    </label>
  );
}
