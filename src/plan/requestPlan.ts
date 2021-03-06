import * as charset from "charset";
import * as got from "got";
import * as http from "http";
import * as iconv from "iconv-lite";
import * as url from "url";
import { IPlan, ITask } from "../interfaces";
import Spider from "../spider";
import NodeSpider from "../spider";

export interface ICurrent extends ITask {
  response: got.Response<Buffer>;
  body: string;
}

export type IHandle =
  (current: ICurrent, spider: Spider)
    => any | Promise<any>;

export interface IOption {
  name: string;
  handle: IHandle;
  failed?: (error: Error, task: ITask, spider: Spider) => any;
  retries?: number;
  toUtf8?: boolean;
  requestOpts?: http.RequestOptions & { encoding: null };  // encoding 必须为 null
}

const defaultOption = {
  failed: (error) => { throw error; },
  toUtf8: true,
  requestOpts: { encoding: null },  // 当输入 option 有requestOpts 设置，将可能导致encoding 不为 null
  retries: 3,
};

export interface IRequestPlan {
  (name: string, handle: IHandle): IPlan;
  (option: IOption): IPlan;
}

export default function requestPlan({
  name,
  handle,
  failed = (error) => { throw error; },
  toUtf8 = true,
  requestOpts = { encoding: null },  // 当输入 option 有requestOpts 设置，将可能导致encoding 不为 null
  retries = 3,
}: IOption): IPlan {
  if (typeof requestOpts === "object" && typeof (requestOpts as any).encoding === "undefined") {
    (requestOpts as any).encoding = null;
  }

  return {
    name,
    retries,
    failed,
    process: async (task, spider) => {
      const res: got.Response<Buffer> = await got(task.url, requestOpts) as any
      const current = { ...task, response: res, body: res.body.toString() };

      if (toUtf8) { current.body = decodeToUtf8(current.response as got.Response<Buffer>); }

      return await handle(current, spider);
    },
  };
}

/**
 * 根据当前任务的response.header和response.body中的编码格式，将currentTask.body转码为utf8格式
 */
export function decodeToUtf8(res: got.Response<Buffer>): string {
  const encoding = charset(res.headers, res.body.toString());
  // 有些时候会无法获得当前网站的编码，原因往往是网站内容过于简单，比如最简单的404界面。此时无需转码
  // TODO: 有没有可能，在需要转码的网站无法获得 encoding？
  if (encoding) {
    return iconv.decode(res.body, encoding);
  } else {
    return res.body.toString();
  }
}
