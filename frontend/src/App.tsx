import { useCallback, useEffect, useState } from "react";
import { ACTORS, type Actor, type Task } from "@task-manager/shared";
import { api, errorMessage } from "./api/client";
import { ActorSelect } from "./components/ActorSelect";
import { CreateTaskForm } from "./components/CreateTaskForm";
import { TaskTable } from "./components/TaskTable";

export function App() {
  const [actor, setActor] = useState<Actor>(ACTORS[0]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Incremented after every successful mutation so open history panels refetch.
  const [historyVersion, setHistoryVersion] = useState(0);

  const loadTasks = useCallback(async () => {
    try {
      setTasks(await api.listTasks());
      setLoadError(null);
    } catch (err) {
      setLoadError(errorMessage(err));
    }
  }, []);

  const handleMutated = useCallback(async () => {
    setHistoryVersion((version) => version + 1);
    await loadTasks();
  }, [loadTasks]);

  useEffect(() => {
    void loadTasks();
  }, [loadTasks]);

  return (
    <main>
      <header className="page-header">
        <h1>Mini Task Manager</h1>
        <ActorSelect value={actor} onChange={setActor} />
      </header>
      <CreateTaskForm actor={actor} onCreated={handleMutated} />
      {loadError && (
        <p className="error" role="alert">
          {loadError}
        </p>
      )}
      <TaskTable
        tasks={tasks}
        actor={actor}
        historyVersion={historyVersion}
        onMutated={handleMutated}
        onConflict={loadTasks}
      />
    </main>
  );
}
