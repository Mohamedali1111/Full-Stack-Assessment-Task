import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { type HydratedDocument, Types } from 'mongoose';

export enum TaskActivityType {
  ASSIGNEE_CHANGED = 'TASK_ASSIGNEE_CHANGED',
}

export class TaskAssigneeChangeMetadata {
  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  from: Types.ObjectId | null;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  to: Types.ObjectId | null;
}

export type TaskActivityDocument = HydratedDocument<TaskActivity>;

@Schema({ timestamps: { createdAt: true, updatedAt: false }, collection: 'task_activities' })
export class TaskActivity {
  @Prop({ type: Types.ObjectId, ref: 'Task', required: true })
  taskId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Project', required: true })
  projectId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  actorId: Types.ObjectId;

  @Prop({ type: String, enum: Object.values(TaskActivityType), required: true })
  type: TaskActivityType;

  @Prop({ type: TaskAssigneeChangeMetadata, required: true })
  metadata: TaskAssigneeChangeMetadata;

  createdAt: Date;
}

export const TaskActivitySchema = SchemaFactory.createForClass(TaskActivity);

TaskActivitySchema.index({ taskId: 1, createdAt: -1, _id: -1 });
