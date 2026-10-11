import type { Actor, Task } from "@task-manager/shared";
import { TaskRow } from "./TaskRow";

interface Props {
  tasks: Task[];
  actor: Actor;
  historyVersion: number;
  onMutated: () => Promise<void>;
  onConflict: () => Promise<void>;
}

export function TaskTable({ tasks, ...rowProps }: Props) {
  if (tasks.length === 0) {
    return <p className="muted">No tasks yet.</p>;
  }
  return (
    <div className="table-wrapper">
      <table>
        <thead>
          <tr>
            <th scope="col">Title</th>
            <th scope="col">Status</th>
            <th scope="col">Last updated</th>
            <th scope="col">Actions</th>
          </tr>
        </thead>
        <tbody>
          {tasks.map((task) => (
            <TaskRow key={task.id} task={task} {...rowProps} />
          ))}
        </tbody>
      </table>
    </div>
  );
}
