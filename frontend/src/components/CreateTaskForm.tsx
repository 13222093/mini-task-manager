import { useState, type FormEvent } from "react";
import type { Actor } from "@task-manager/shared";
import { api, errorMessage } from "../api/client";

interface Props {
  actor: Actor;
  onCreated: () => Promise<void>;
}

// No required or maxLength attributes: the backend is the only validator,
// and its message is shown as is.
export function CreateTaskForm({ actor, onCreated }: Props) {
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.createTask(title, actor);
      setTitle("");
      await onCreated();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="create-form" onSubmit={handleSubmit}>
      <label htmlFor="new-task-title">New task</label>
      <input
        id="new-task-title"
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        aria-invalid={error !== null}
        aria-describedby={error ? "new-task-error" : undefined}
      />
      <button type="submit" disabled={busy}>
        Add task
      </button>
      {error && (
        <p id="new-task-error" className="error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
