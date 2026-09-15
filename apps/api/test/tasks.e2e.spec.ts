import type { INestApplication } from '@nestjs/common';
import type { Connection } from 'mongoose';
import request from 'supertest';
import { OrganizationRole, ProjectRole, TaskPriority, TaskStatus } from '@projectflow/shared';
import { createTestApp, resetDatabase } from './utils/test-app';
import {
  addOrganizationMember,
  addProjectMember,
  authHeader,
  createOrganization,
  createProject,
  createTask,
  registerUser,
  type TestUser,
} from './utils/fixtures';

describe('Tasks', () => {
  let app: INestApplication;
  let connection: Connection;

  let owner: TestUser;
  let projectManager: TestUser;
  let member: TestUser;
  let assignee: TestUser;
  let outsider: TestUser;
  let organizationId: string;
  let projectId: string;

  beforeAll(async () => {
    ({ app, connection } = await createTestApp());
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDatabase(connection);

    owner = await registerUser(app, 'Ammar Yaser', 'ammar@example.com');
    projectManager = await registerUser(app, 'Ahmed Hassan', 'ahmed@example.com');
    member = await registerUser(app, 'Magd Ali', 'magd@example.com');
    assignee = await registerUser(app, 'Nour Salem', 'nour@example.com');
    outsider = await registerUser(app, 'Outside User', 'outside@example.com');

    organizationId = await createOrganization(
      connection,
      'Acme Software',
      'acme-software',
      owner.id,
    );
    await addOrganizationMember(connection, organizationId, owner.id, OrganizationRole.OWNER);
    await addOrganizationMember(
      connection,
      organizationId,
      projectManager.id,
      OrganizationRole.MEMBER,
    );
    await addOrganizationMember(connection, organizationId, member.id, OrganizationRole.MEMBER);
    await addOrganizationMember(connection, organizationId, assignee.id, OrganizationRole.MEMBER);

    projectId = await createProject(
      connection,
      organizationId,
      'Internal Platform',
      'ENG',
      owner.id,
    );
    await addProjectMember(connection, projectId, projectManager.id, ProjectRole.PROJECT_MANAGER);
    await addProjectMember(connection, projectId, member.id, ProjectRole.MEMBER);
    await addProjectMember(connection, projectId, assignee.id, ProjectRole.MEMBER);
  });

  it('lets a project member create a task', async () => {
    const response = await request(app.getHttpServer())
      .post(`/projects/${projectId}/tasks`)
      .set('Authorization', authHeader(member))
      .send({
        title: 'Improve API error handling',
        description: 'Normalise validation and permission errors.',
        priority: TaskPriority.HIGH,
      })
      .expect(201);

    expect(response.body).toMatchObject({
      key: 'ENG-1',
      number: 1,
      title: 'Improve API error handling',
      status: TaskStatus.TODO,
      priority: TaskPriority.HIGH,
    });
    expect(response.body.createdBy).toMatchObject({ email: 'magd@example.com' });
  });

  it('numbers tasks sequentially within a project', async () => {
    for (const title of ['First task', 'Second task', 'Third task']) {
      await request(app.getHttpServer())
        .post(`/projects/${projectId}/tasks`)
        .set('Authorization', authHeader(member))
        .send({ title })
        .expect(201);
    }

    const response = await request(app.getHttpServer())
      .get(`/projects/${projectId}/tasks`)
      .set('Authorization', authHeader(member))
      .expect(200);

    expect(response.body.total).toBe(3);
    expect(response.body.items.map((task: { key: string }) => task.key)).toEqual([
      'ENG-1',
      'ENG-2',
      'ENG-3',
    ]);
  });

  it('keeps task numbers and keys unique when tasks are created concurrently', async () => {
    const requestCount = 12;

    const responses = await Promise.all(
      Array.from({ length: requestCount }, (_value, index) =>
        request(app.getHttpServer())
          .post(`/projects/${projectId}/tasks`)
          .set('Authorization', authHeader(member))
          .send({ title: `Concurrent task ${index + 1}` })
          .expect(201),
      ),
    );

    const created = responses.map((response) => response.body as { number: number; key: string });
    const createdNumbers = created.map((task) => task.number);
    const createdKeys = created.map((task) => task.key);

    const persisted = await connection
      .collection('tasks')
      .find({ projectId: new connection.base.Types.ObjectId(projectId) })
      .project<{ number: number; key: string }>({ number: 1, key: 1, _id: 0 })
      .toArray();
    const persistedNumbers = persisted.map((task) => task.number);
    const persistedKeys = persisted.map((task) => task.key);

    expect({
      duplicateCreatedNumbers: duplicatesOf(createdNumbers),
      duplicateCreatedKeys: duplicatesOf(createdKeys),
      duplicatePersistedNumbers: duplicatesOf(persistedNumbers),
      duplicatePersistedKeys: duplicatesOf(persistedKeys),
      createdNumbers,
      createdKeys,
      persistedNumbers,
      persistedKeys,
    }).toEqual({
      duplicateCreatedNumbers: [],
      duplicateCreatedKeys: [],
      duplicatePersistedNumbers: [],
      duplicatePersistedKeys: [],
      createdNumbers,
      createdKeys,
      persistedNumbers,
      persistedKeys,
    });
  });

  it('keeps task numbers and keys unique for normally created projects with initialized counters', async () => {
    const projectResponse = await request(app.getHttpServer())
      .post('/projects')
      .set('Authorization', authHeader(owner))
      .send({
        organizationId,
        name: 'API Platform',
        key: 'API',
      })
      .expect(201);

    const createdProjectId = projectResponse.body.id as string;
    const initializedProject = await connection.collection('projects').findOne({
      _id: new connection.base.Types.ObjectId(createdProjectId),
    });
    expect(initializedProject?.lastTaskNumber).toBe(0);

    const requestCount = 12;
    const responses = await Promise.all(
      Array.from({ length: requestCount }, (_value, index) =>
        request(app.getHttpServer())
          .post(`/projects/${createdProjectId}/tasks`)
          .set('Authorization', authHeader(owner))
          .send({ title: `Initialized counter task ${index + 1}` })
          .expect(201),
      ),
    );

    const created = responses.map((response) => response.body as { number: number; key: string });
    const createdNumbers = created.map((task) => task.number);
    const createdKeys = created.map((task) => task.key);

    const persisted = await connection
      .collection('tasks')
      .find({ projectId: new connection.base.Types.ObjectId(createdProjectId) })
      .project<{ number: number; key: string }>({ number: 1, key: 1, _id: 0 })
      .toArray();
    const persistedNumbers = persisted.map((task) => task.number);
    const persistedKeys = persisted.map((task) => task.key);

    expect({
      duplicateCreatedNumbers: duplicatesOf(createdNumbers),
      duplicateCreatedKeys: duplicatesOf(createdKeys),
      duplicatePersistedNumbers: duplicatesOf(persistedNumbers),
      duplicatePersistedKeys: duplicatesOf(persistedKeys),
      finalProjectCounter: (
        await connection.collection('projects').findOne({
          _id: new connection.base.Types.ObjectId(createdProjectId),
        })
      )?.lastTaskNumber,
    }).toEqual({
      duplicateCreatedNumbers: [],
      duplicateCreatedKeys: [],
      duplicatePersistedNumbers: [],
      duplicatePersistedKeys: [],
      finalProjectCounter: requestCount,
    });
  });

  it('continues numbering from existing tasks when a legacy project has no counter', async () => {
    await createTask(connection, projectId, 'ENG', 5, 'Existing legacy task', member.id);

    const requestCount = 4;
    const responses = await Promise.all(
      Array.from({ length: requestCount }, (_value, index) =>
        request(app.getHttpServer())
          .post(`/projects/${projectId}/tasks`)
          .set('Authorization', authHeader(member))
          .send({ title: `Legacy concurrent task ${index + 1}` })
          .expect(201),
      ),
    );

    const created = responses
      .map((response) => response.body as { number: number; key: string })
      .sort((left, right) => left.number - right.number)
      .map((task) => ({ number: task.number, key: task.key }));

    expect(created).toEqual([
      { number: 6, key: 'ENG-6' },
      { number: 7, key: 'ENG-7' },
      { number: 8, key: 'ENG-8' },
      { number: 9, key: 'ENG-9' },
    ]);
  });

  it('does not persist a zero counter when a legacy project is hydrated and saved', async () => {
    await createTask(connection, projectId, 'ENG', 5, 'Existing legacy task', member.id);

    const ProjectModel = connection.model('Project');
    const project = await ProjectModel.findById(projectId).exec();
    expect(project).not.toBeNull();

    project!.set('description', 'Updated without touching task numbering');
    await project!.save();

    const savedProject = await connection.collection('projects').findOne({
      _id: new connection.base.Types.ObjectId(projectId),
    });
    expect(Object.prototype.hasOwnProperty.call(savedProject, 'lastTaskNumber')).toBe(false);

    const response = await request(app.getHttpServer())
      .post(`/projects/${projectId}/tasks`)
      .set('Authorization', authHeader(member))
      .send({ title: 'Task after legacy project save' })
      .expect(201);

    expect(response.body).toMatchObject({
      number: 6,
      key: 'ENG-6',
    });
  });

  it('does not reuse a task number after a task is deleted', async () => {
    const first = await request(app.getHttpServer())
      .post(`/projects/${projectId}/tasks`)
      .set('Authorization', authHeader(member))
      .send({ title: 'Temporary task' })
      .expect(201);

    await request(app.getHttpServer())
      .delete(`/tasks/${first.body.id}`)
      .set('Authorization', authHeader(owner))
      .expect(204);

    const second = await request(app.getHttpServer())
      .post(`/projects/${projectId}/tasks`)
      .set('Authorization', authHeader(member))
      .send({ title: 'Task after deletion' })
      .expect(201);

    expect(second.body).toMatchObject({
      number: 2,
      key: 'ENG-2',
    });
  });

  it('refuses to create a task for someone outside the project', async () => {
    await request(app.getHttpServer())
      .post(`/projects/${projectId}/tasks`)
      .set('Authorization', authHeader(outsider))
      .send({ title: 'Should not be created' })
      .expect(403);
  });

  it('refuses to list tasks for someone outside the project', async () => {
    await request(app.getHttpServer())
      .get(`/projects/${projectId}/tasks`)
      .set('Authorization', authHeader(outsider))
      .expect(403);
  });

  it('refuses to update task status for someone outside the project', async () => {
    const taskId = await createTask(
      connection,
      projectId,
      'ENG',
      1,
      'Keep private project task protected',
      member.id,
    );

    const response = await request(app.getHttpServer())
      .patch(`/tasks/${taskId}/status`)
      .set('Authorization', authHeader(outsider))
      .send({ status: TaskStatus.IN_PROGRESS });

    const task = await connection.collection('tasks').findOne({
      _id: new connection.base.Types.ObjectId(taskId),
    });

    expect({
      statusCode: response.status,
      persistedStatus: task?.status,
    }).toEqual({
      statusCode: 403,
      persistedStatus: TaskStatus.TODO,
    });
  });

  it('lets a project member update task status', async () => {
    const taskId = await createTask(
      connection,
      projectId,
      'ENG',
      1,
      'Move accessible task forward',
      member.id,
    );

    const response = await request(app.getHttpServer())
      .patch(`/tasks/${taskId}/status`)
      .set('Authorization', authHeader(member))
      .send({ status: TaskStatus.IN_PROGRESS })
      .expect(200);

    expect(response.body).toMatchObject({
      id: taskId,
      status: TaskStatus.IN_PROGRESS,
      key: 'ENG-1',
    });
  });

  it('lets a project member assign themselves to a task', async () => {
    const taskId = await createTask(
      connection,
      projectId,
      'ENG',
      1,
      'Self-assigned task',
      owner.id,
    );

    const response = await request(app.getHttpServer())
      .patch(`/tasks/${taskId}/assignee`)
      .set('Authorization', authHeader(member))
      .send({ assigneeId: member.id })
      .expect(200);

    expect(response.body).toMatchObject({
      id: taskId,
      createdBy: { email: owner.email },
      assignee: { id: member.id, email: member.email },
    });

    const task = await connection.collection('tasks').findOne({
      _id: new connection.base.Types.ObjectId(taskId),
    });
    expect(task?.assigneeId?.toString()).toBe(member.id);
  });

  it('lets an organization owner assign another project member to a task', async () => {
    const taskId = await createTask(
      connection,
      projectId,
      'ENG',
      1,
      'Owner-assigned task',
      member.id,
    );

    const response = await request(app.getHttpServer())
      .patch(`/tasks/${taskId}/assignee`)
      .set('Authorization', authHeader(owner))
      .send({ assigneeId: assignee.id })
      .expect(200);

    expect(response.body).toMatchObject({
      id: taskId,
      createdBy: { email: member.email },
      assignee: { id: assignee.id, email: assignee.email },
    });

    const task = await connection.collection('tasks').findOne({
      _id: new connection.base.Types.ObjectId(taskId),
    });
    expect(task?.assigneeId?.toString()).toBe(assignee.id);
  });

  it('lets a project manager assign another project member to a task', async () => {
    const taskId = await createTask(
      connection,
      projectId,
      'ENG',
      1,
      'Project-manager-assigned task',
      member.id,
    );

    const response = await request(app.getHttpServer())
      .patch(`/tasks/${taskId}/assignee`)
      .set('Authorization', authHeader(projectManager))
      .send({ assigneeId: assignee.id })
      .expect(200);

    expect(response.body).toMatchObject({
      id: taskId,
      assignee: { id: assignee.id, email: assignee.email },
    });

    const task = await connection.collection('tasks').findOne({
      _id: new connection.base.Types.ObjectId(taskId),
    });
    expect(task?.assigneeId?.toString()).toBe(assignee.id);
  });

  it('refuses to let a regular project member assign another user', async () => {
    const taskId = await createTask(
      connection,
      projectId,
      'ENG',
      1,
      'Protected assignment task',
      member.id,
    );

    await request(app.getHttpServer())
      .patch(`/tasks/${taskId}/assignee`)
      .set('Authorization', authHeader(member))
      .send({ assigneeId: assignee.id })
      .expect(403);

    const task = await connection.collection('tasks').findOne({
      _id: new connection.base.Types.ObjectId(taskId),
    });
    expect(task?.assigneeId).toBeUndefined();
  });

  it('refuses to assign a user outside the project', async () => {
    const taskId = await createTask(
      connection,
      projectId,
      'ENG',
      1,
      'Invalid assignee task',
      member.id,
    );

    await request(app.getHttpServer())
      .patch(`/tasks/${taskId}/assignee`)
      .set('Authorization', authHeader(owner))
      .send({ assigneeId: outsider.id })
      .expect(400);

    const task = await connection.collection('tasks').findOne({
      _id: new connection.base.Types.ObjectId(taskId),
    });
    expect(task?.assigneeId).toBeUndefined();
  });

  it('rejects a malformed assignee id', async () => {
    const taskId = await createTask(
      connection,
      projectId,
      'ENG',
      1,
      'Malformed assignee task',
      member.id,
    );

    await request(app.getHttpServer())
      .patch(`/tasks/${taskId}/assignee`)
      .set('Authorization', authHeader(owner))
      .send({ assigneeId: 'not-an-object-id' })
      .expect(400);

    const task = await connection.collection('tasks').findOne({
      _id: new connection.base.Types.ObjectId(taskId),
    });
    expect(task?.assigneeId).toBeUndefined();
  });

  it('lets an organization owner unassign the current assignee', async () => {
    const taskId = await createTask(
      connection,
      projectId,
      'ENG',
      1,
      'Assigned task to clear',
      member.id,
    );
    await connection.collection('tasks').updateOne(
      { _id: new connection.base.Types.ObjectId(taskId) },
      { $set: { assigneeId: new connection.base.Types.ObjectId(assignee.id) } },
    );

    const response = await request(app.getHttpServer())
      .patch(`/tasks/${taskId}/assignee`)
      .set('Authorization', authHeader(owner))
      .send({ assigneeId: null })
      .expect(200);

    expect(response.body).toMatchObject({
      id: taskId,
      assignee: null,
    });

    const task = await connection.collection('tasks').findOne({
      _id: new connection.base.Types.ObjectId(taskId),
    });
    expect(task?.assigneeId).toBeNull();
  });

  it('lets a project manager unassign the current assignee', async () => {
    const taskId = await createTask(
      connection,
      projectId,
      'ENG',
      1,
      'Assigned task for project manager to clear',
      member.id,
    );
    await connection.collection('tasks').updateOne(
      { _id: new connection.base.Types.ObjectId(taskId) },
      { $set: { assigneeId: new connection.base.Types.ObjectId(assignee.id) } },
    );

    const response = await request(app.getHttpServer())
      .patch(`/tasks/${taskId}/assignee`)
      .set('Authorization', authHeader(projectManager))
      .send({ assigneeId: null })
      .expect(200);

    expect(response.body).toMatchObject({
      id: taskId,
      assignee: null,
    });

    const task = await connection.collection('tasks').findOne({
      _id: new connection.base.Types.ObjectId(taskId),
    });
    expect(task?.assigneeId).toBeNull();
  });

  it('returns the deleted-user placeholder when an assigned user cannot be resolved', async () => {
    const taskId = await createTask(
      connection,
      projectId,
      'ENG',
      1,
      'Task with missing assignee user',
      member.id,
    );
    const missingUserId = new connection.base.Types.ObjectId();
    await connection.collection('tasks').updateOne(
      { _id: new connection.base.Types.ObjectId(taskId) },
      { $set: { assigneeId: missingUserId } },
    );

    const response = await request(app.getHttpServer())
      .get(`/tasks/${taskId}`)
      .set('Authorization', authHeader(member))
      .expect(200);

    expect(response.body).toMatchObject({
      id: taskId,
      assignee: {
        id: '',
        name: 'Unknown user',
        email: '',
        avatarUrl: null,
      },
    });
  });

  it('refuses to let a regular project member unassign a task', async () => {
    const taskId = await createTask(
      connection,
      projectId,
      'ENG',
      1,
      'Assigned task protected from member unassign',
      member.id,
    );
    await connection.collection('tasks').updateOne(
      { _id: new connection.base.Types.ObjectId(taskId) },
      { $set: { assigneeId: new connection.base.Types.ObjectId(assignee.id) } },
    );

    await request(app.getHttpServer())
      .patch(`/tasks/${taskId}/assignee`)
      .set('Authorization', authHeader(member))
      .send({ assigneeId: null })
      .expect(403);

    const task = await connection.collection('tasks').findOne({
      _id: new connection.base.Types.ObjectId(taskId),
    });
    expect(task?.assigneeId?.toString()).toBe(assignee.id);
  });

  it('records activity when a task moves from unassigned to assigned', async () => {
    const taskId = await createTask(
      connection,
      projectId,
      'ENG',
      1,
      'Activity assignment task',
      member.id,
    );

    await request(app.getHttpServer())
      .patch(`/tasks/${taskId}/assignee`)
      .set('Authorization', authHeader(projectManager))
      .send({ assigneeId: assignee.id })
      .expect(200);

    const response = await request(app.getHttpServer())
      .get(`/tasks/${taskId}/activity`)
      .set('Authorization', authHeader(member))
      .expect(200);

    expect(response.body).toMatchObject({
      total: 1,
      page: 1,
      pageSize: expect.any(Number),
      items: [
        {
          type: 'TASK_ASSIGNEE_CHANGED',
          taskId,
          actor: { id: projectManager.id, email: projectManager.email },
          metadata: { from: null, to: assignee.id },
          createdAt: expect.any(String),
        },
      ],
    });
  });

  it('records newest-first activity when a task is reassigned to a different user', async () => {
    const taskId = await createTask(
      connection,
      projectId,
      'ENG',
      1,
      'Activity reassignment task',
      member.id,
    );

    await request(app.getHttpServer())
      .patch(`/tasks/${taskId}/assignee`)
      .set('Authorization', authHeader(projectManager))
      .send({ assigneeId: member.id })
      .expect(200);
    await request(app.getHttpServer())
      .patch(`/tasks/${taskId}/assignee`)
      .set('Authorization', authHeader(projectManager))
      .send({ assigneeId: assignee.id })
      .expect(200);

    const response = await request(app.getHttpServer())
      .get(`/tasks/${taskId}/activity`)
      .set('Authorization', authHeader(member))
      .expect(200);

    expect(response.body).toMatchObject({
      total: 2,
      items: [
        {
          type: 'TASK_ASSIGNEE_CHANGED',
          metadata: { from: member.id, to: assignee.id },
          actor: { id: projectManager.id },
        },
        {
          type: 'TASK_ASSIGNEE_CHANGED',
          metadata: { from: null, to: member.id },
          actor: { id: projectManager.id },
        },
      ],
    });
  });

  it('records activity when an assigned task is unassigned', async () => {
    const taskId = await createTask(
      connection,
      projectId,
      'ENG',
      1,
      'Activity unassignment task',
      member.id,
    );

    await request(app.getHttpServer())
      .patch(`/tasks/${taskId}/assignee`)
      .set('Authorization', authHeader(projectManager))
      .send({ assigneeId: assignee.id })
      .expect(200);
    await request(app.getHttpServer())
      .patch(`/tasks/${taskId}/assignee`)
      .set('Authorization', authHeader(projectManager))
      .send({ assigneeId: null })
      .expect(200);

    const response = await request(app.getHttpServer())
      .get(`/tasks/${taskId}/activity`)
      .set('Authorization', authHeader(member))
      .expect(200);

    expect(response.body).toMatchObject({
      total: 2,
    });
    expect(response.body.items[0]).toMatchObject({
      type: 'TASK_ASSIGNEE_CHANGED',
      metadata: { from: assignee.id, to: null },
      actor: { id: projectManager.id },
    });
  });

  it('does not record activity when assigning the same assignee again', async () => {
    const taskId = await createTask(
      connection,
      projectId,
      'ENG',
      1,
      'Same-assignee activity task',
      member.id,
    );

    await request(app.getHttpServer())
      .patch(`/tasks/${taskId}/assignee`)
      .set('Authorization', authHeader(projectManager))
      .send({ assigneeId: assignee.id })
      .expect(200);
    await request(app.getHttpServer())
      .patch(`/tasks/${taskId}/assignee`)
      .set('Authorization', authHeader(projectManager))
      .send({ assigneeId: assignee.id })
      .expect(200);

    const response = await request(app.getHttpServer())
      .get(`/tasks/${taskId}/activity`)
      .set('Authorization', authHeader(member))
      .expect(200);

    expect(response.body).toMatchObject({
      total: 1,
      items: [
        {
          type: 'TASK_ASSIGNEE_CHANGED',
          metadata: { from: null, to: assignee.id },
        },
      ],
    });
  });

  it('refuses to show task activity to someone outside the project', async () => {
    const taskId = await createTask(
      connection,
      projectId,
      'ENG',
      1,
      'Private activity task',
      member.id,
    );

    await request(app.getHttpServer())
      .get(`/tasks/${taskId}/activity`)
      .set('Authorization', authHeader(outsider))
      .expect(403);
  });

  it('paginates task activity newest first', async () => {
    const taskId = await createTask(
      connection,
      projectId,
      'ENG',
      1,
      'Paginated activity task',
      member.id,
    );

    for (const assigneeId of [member.id, assignee.id, null, member.id, assignee.id]) {
      await request(app.getHttpServer())
        .patch(`/tasks/${taskId}/assignee`)
        .set('Authorization', authHeader(projectManager))
        .send({ assigneeId })
        .expect(200);
    }

    const firstPage = await request(app.getHttpServer())
      .get(`/tasks/${taskId}/activity`)
      .query({ page: 1, pageSize: 2 })
      .set('Authorization', authHeader(member))
      .expect(200);
    const secondPage = await request(app.getHttpServer())
      .get(`/tasks/${taskId}/activity`)
      .query({ page: 2, pageSize: 2 })
      .set('Authorization', authHeader(member))
      .expect(200);

    expect(firstPage.body).toMatchObject({
      total: 5,
      page: 1,
      pageSize: 2,
      items: [
        { metadata: { from: member.id, to: assignee.id } },
        { metadata: { from: null, to: member.id } },
      ],
    });
    expect(secondPage.body).toMatchObject({
      total: 5,
      page: 2,
      pageSize: 2,
      items: [
        { metadata: { from: assignee.id, to: null } },
        { metadata: { from: member.id, to: assignee.id } },
      ],
    });
  });

  it('rejects a task without a usable title', async () => {
    const response = await request(app.getHttpServer())
      .post(`/projects/${projectId}/tasks`)
      .set('Authorization', authHeader(member))
      .send({ title: 'ab' })
      .expect(400);

    expect(response.body.statusCode).toBe(400);
  });

  it('filters the task list by status', async () => {
    await request(app.getHttpServer())
      .post(`/projects/${projectId}/tasks`)
      .set('Authorization', authHeader(member))
      .send({ title: 'Work in flight', status: TaskStatus.IN_PROGRESS })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/projects/${projectId}/tasks`)
      .set('Authorization', authHeader(member))
      .send({ title: 'Not started yet' })
      .expect(201);

    const response = await request(app.getHttpServer())
      .get(`/projects/${projectId}/tasks`)
      .query({ status: TaskStatus.IN_PROGRESS })
      .set('Authorization', authHeader(member))
      .expect(200);

    expect(response.body.total).toBe(1);
    expect(response.body.items[0]).toMatchObject({ title: 'Work in flight' });
  });
});

function duplicatesOf<T>(values: T[]): T[] {
  return Array.from(new Set(values.filter((value, index) => values.indexOf(value) !== index)));
}
