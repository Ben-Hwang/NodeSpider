import { EventEmitter } from "events";
import * as pRetry from "p-retry";
import * as uuid from "uuid";
import {
  IOptions,
  IOpts,
  IPipe,
  IPipeItems,
  IPlan,
  IQueue,
  IState,
  IStatus,
  ITask,
} from "./interfaces";
import downloadPlan from "./plan/downloadPlan";
import requestPlan from "./plan/requestPlan";
import Queue from "./queue";

const defaultOption: IOpts = {
  concurrency: 20,
  queue: new Queue(),
  pool: new Set<string>(),
  heartbeat: 2000,
  genUUID: uuid,
  stillAlive: false,
};

const event = {
  statusChange: "statusChange",
  addTask: "addTask",
  taskStart: "taskStart",
  taskDone: "taskDone",
  queueEmpty: "queueEmpty",
  heartbeat: "heartbeat",
  goodbye: "goodbye",
};

/**
 * class of NodeSpider
 * @class NodeSpider
 */
export default class NodeSpider extends EventEmitter {
  public _STATE: IState;
  /**
   * create an instance of NodeSpider
   * @param option
   */
  constructor(option: IOptions = {}) {
    super();
    if (option && typeof option !== "object") {
      throw new TypeError("option is NOT required, but it should be a object if passed");
    }
    const opts = { ...defaultOption, ...option };
    this._STATE = {
      opts,
      currentTasks: [],
      pipeStore: [],
      planStore: [],
      queue: opts.queue,
      heartbeat: setInterval(() => this.emit(event.heartbeat), opts.heartbeat),
      pool: opts.pool,
      status: "vacant",   // 初始化后，在获得新任务前，将保持“空闲”状态
    };

    this.on(event.queueEmpty, () => {
      if (this._STATE.currentTasks.length === 0) {
        changeStatus("vacant", this);
      }
    });
    this.on(event.addTask, () => work(this));
    this.on(event.taskDone, () => work(this));
    this.on(event.heartbeat, () => work(this));

  }

  /**
   * Check whether the url has been added
   * @param {string} url
   * @returns {boolean}
   */
  public has(url: string): boolean {
    if (typeof url !== "string") {
      throw new TypeError(`url is required and must be a string`);
    }
    return this._STATE.pool.has(url);
  }

  /**
   * 过滤掉一个数组中的重复链接，以及所有已被添加的链接，返回一个新数组
   * @param urls {array}
   * @returns {array}
   */
  public filter(urls: string[]): string[] {
    if (!Array.isArray(urls)) {
      throw new TypeError(`urls is required and must be an array of strings`);
    }
    for (const url of urls) {
      if (typeof url !== "string") {
        throw new TypeError(`urls is required and must be an array of strings`);
      }
    }

    const set = new Set(urls);
    return Array.from(set.values()).filter((u) => !this.has(u));
  }

  /**
   * add new plan
   * @param  {IPlan}  plan plan object
   * @return {void}
   */
  public plan(plan: IPlan): void {
    if (this._STATE.planStore.find((p) => p.name === plan.name)) {
      throw new TypeError(`The plan named "${plan.name}" already exists`);
    }
    this._STATE.planStore.push(plan);
  }

  /**
   * connect new pipe
   * @param  {IPipe}  target pipe object
   * @return {void}
   */
  public pipe(newPipe: IPipe): void {
    if (this._STATE.pipeStore.find((p) => p.name === newPipe.name)) {
      throw new TypeError(`The pipe named "${name}" already exists`);
    }
    this._STATE.pipeStore.push(newPipe);
  }

  /**
   * add new tasks, return tasks' uuids
   * @param planName target plan name
   * @param url url(s)
   * @param info attached information
   */
  public add(planName: string, url: string | string[], info: { [index: string]: any } = {}): string[] {
    const urls = Array.isArray(url) ? url : [url];
    for (const u of urls) {
      if (typeof u !== "string") {
        throw new TypeError("url is required and must be a string or an array of strings");
      }
    }
    if (typeof planName !== "string") {
      throw new TypeError("planName is required and must be a string");
    }

    const plan = this._STATE.planStore.find((p) => p.name === planName);
    if (!plan) {
      throw new TypeError(`No such plan named "${planName}"`);
    }

    const tasks: ITask[] = urls.map((u) => ({
      uid: this._STATE.opts.genUUID(),
      url: u,
      planName,
      info: JSON.parse(JSON.stringify(info)),
    }));
    for (const task of tasks) {
      this._STATE.queue.add(task);
      this._STATE.pool.add(task.url);
      this.emit(event.addTask, task);
    }

    return tasks.map((t) => t.uid);
  }

  /**
   * filter new tasks and add, return tasks' uuids
   * @param planName target plan name
   * @param url url(s)
   * @param info attached information
   */
  public addU(planName: string, url: string | string[], info?: { [index: string]: any }): string[] {
    const urls = Array.isArray(url) ? url : [url];
    return this.add(planName, this.filter(urls), info);
  }

  /**
   * Save data through a pipe
   * @param  {string} pipeName pipe name
   * @param  {any}    data     data you need to save
   * @return {void}
   */
  public save(pipeName: string, data: { [index: string]: any }) {
    if (typeof pipeName !== "string") {
      throw new TypeError(`pipeName is required and must be a string`);
    }
    if (typeof data !== "object") {
      throw new TypeError(`data is required and must be a object`);
    }
    const pipe = this._STATE.pipeStore.find((p) => p.name === pipeName);
    if (!pipe) {
      throw new TypeError(`No such pipe named ${pipeName}`);
    }

    if (! pipe.items) {
      pipe.items = Object.keys(data);
    }

    const d = (Array.isArray(pipe.items)) ?
      pipe.items.map((item) => (typeof data[item] !== "undefined") ? data[item] : null) :
        Object.entries(pipe.items).map(([ item, fn ]) => (typeof data[item] !== "undefined") ? fn(data[item]) : null);

    pipe.write(d);
  }

  public pause() {
    changeStatus("pause", this);
  }

  public active() {
    changeStatus("active", this);
  }

  public end() {
    changeStatus("end", this);
  }

}

function changeStatus(status: IStatus, spider: NodeSpider) {
  const preStatus = spider._STATE.status;
  spider._STATE.status = status;
  spider.emit(event.statusChange, status, preStatus);
}

async function startTask(task: ITask, spider: NodeSpider) {
  spider._STATE.currentTasks.push(task);
  spider.emit(event.taskStart, task);

  const plan = spider._STATE.planStore.find((p) => p.name === task.planName) as IPlan;
  await pRetry(() => plan.process(task, spider), { retries: plan.retries })
    .catch((err) => plan.failed(err, task, spider));

  spider._STATE.currentTasks = spider._STATE.currentTasks.filter(({ uid }) => uid !== task.uid);
  spider.emit(event.taskDone, task);
}

function isFullyLoaded(spider: NodeSpider): boolean {
  const maxConcurrency = spider._STATE.opts.concurrency;
  const currentTasksNum = spider._STATE.currentTasks.length;
  return currentTasksNum >= maxConcurrency;
}

async function work(spider: NodeSpider) {
  if (spider._STATE.status === "active" && !isFullyLoaded(spider)) {
    const task = spider._STATE.queue.next();
    if (task) {
      startTask(task, spider);
      work(spider);
    } else {
      spider.emit(event.queueEmpty);
    }
  } else if (spider._STATE.status === "vacant" && !isFullyLoaded(spider)) {
    const task = spider._STATE.queue.next();
    if (task) {
      startTask(task, spider);
      work(spider);
      changeStatus("active", spider);
    } else {
      spider.emit(event.queueEmpty);
      if (!spider._STATE.opts.stillAlive) {
        spider.end();
      }
    }
  } else if (spider._STATE.status === "end" && spider._STATE.currentTasks.length === 0) {
    for (const pipe of spider._STATE.pipeStore) {
      pipe.end();
    }
    clearInterval(spider._STATE.heartbeat);
    spider.emit(event.goodbye);
  }
}
