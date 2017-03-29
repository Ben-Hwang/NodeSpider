// TODO: request 传入 opts，以及更多的 option，类似 proxy
// TODO: 更好的报错机制: 报错建议？以及去除多余的 console.error
// TODO: 解决 save 方法保存json格式不好用的问题： 没有[],直接也没有逗号隔开
// BUG: 使用url.resolve补全url，可能导致 'http://www.xxx.com//www.xxx.com' 的问题。补全前，使用 is-absolute-url 包判断, 或考录使用 relative-url 代替
import * as charset from "charset";
import * as cheerio from "cheerio";
import { EventEmitter } from "events";
import * as fs from "fs";
import * as iconv from "iconv-lite";
import * as request from "request";
import * as url from "url";
import List from "./List";
import { JsonTable, TxtTable } from "./Table";

enum TaskType {
    crawling,
    download,
};

interface IOption {
    multiTasking: number;
    jq: boolean;
    preToUtf8: boolean;
    defaultRetry: number;
    defaultDownloadPath: string;
}

interface ITask {
    type: TaskType;
    url: string;
    callback: (err, currentTask, $) => void;
    jq ?: boolean;
    preToUtf8 ?: boolean;

    info ?: {
        maxRetry: number;
        retried: number;
        finalErrorCallback: (currentTask: ITask) => void;
    };
}

interface IStatus {
    _working: boolean;
    _currentMultiTask: number;
}
// 简单上手的回掉函数 + 自由定制的事件驱动

const defaultOption: IOption = {
    defaultDownloadPath: "",
    defaultRetry: 3,
    jq: true,
    multiTasking: 20,
    preToUtf8: true,
};

class NodeSpider extends EventEmitter {
    protected _OPTION: IOption;
    protected _TODOLIST: List <ITask> ;
    protected _STATUS: IStatus;
    protected _TABLE: object;
    constructor(userOption = {}) {
        super();
        Object.assign(defaultOption, userOption);
        this._OPTION = defaultOption;

        this._STATUS = {
            _currentMultiTask: 0, // 当前正在进行的任务数量
            _working: false,
        };

        this._TODOLIST = new List <ITask> ();

        this._TABLE = {};

        this.on("start_a_task", (type) => this._STATUS._currentMultiTask ++);
        this.on("done_a_task", (type) => {
            this._STATUS._currentMultiTask --;
            this._fire();
        });
    }

    /**
     * 向爬虫的 todo-list 添加新的任务(不检查是否重复链接)
     * @param {ITask} task
     * @memberOf NodeSpider
     */
    public addTask(task: ITask) {
        (task as ITask).info = {
            finalErrorCallback: null,
            maxRetry: null,
            retried: 0,
        };
        this._TODOLIST.add(task.url, (task as ITask));
    }

    /**
     * 检测链接是否已添加过
     * @param {any} url 待检查的链接
     * @returns {boolean}
     * @memberOf NodeSpider
     */
    public check(url) {
        return this._TODOLIST.check(url);
    }

    public start(url, callback) {
        // TODO: init check

        if (url && callback) {
            this.addTask({
                type: TaskType.crawling,
                url,
                callback,
            });
        }

        this._STATUS._working = true;
        this._fire();
    }

    // 重写
    public retry(currentTask: ITask, maxRetry= this._OPTION.defaultRetry , finalErrorCallback: (currentTask: ITask) => void) {

        if (!finalErrorCallback) {
            finalErrorCallback = () => {
                this.save("log", currentTask);
            };
        }

        if (currentTask.info.maxRetry === null) {
            currentTask.info.maxRetry = maxRetry;
            currentTask.info.finalErrorCallback = finalErrorCallback;
        }

        if (currentTask.info.maxRetry > currentTask.info.retried) {
            currentTask.info.retried += 1;
            // 将 error 和 response 信息删除，节省排队时的内存占用
            (currentTask as any).response = null;
            (currentTask as any).error = null;
            this._TODOLIST.jump(currentTask.url, currentTask);
        } else {
            currentTask.info.finalErrorCallback(currentTask);
        }

    }

    public decode(st, encoding) {
        return iconv.decode(st, encoding);
    }

    public save(item, data) {
        // TODO: 如果item为对象，则为数据库。通过用户在 item 中自定义的标识符来判断是否已存在
        // 暂时只完成保存到文本的功能，所以默认 item 为文件路径字符串
        if (this._TABLE[item]) {
            this._TABLE[item].add(data);
            return true;
        }
        // 如果不存在，则新建一个table实例
        let header = Object.keys(data);
        // 根据路径中的文件后缀名，决定新建哪种table
        if (/.txt$/.test(item)) {
            this._TABLE[item] = new TxtTable(item, header);
            this._TABLE[item].add(data);
        } else {
            this._TABLE[item] = new JsonTable(item, header);
            this._TABLE[item].add(data);
        }
    }

    /**
     * 发送网络请求
     */
    public get(url, opts) {
        interface IResult {
            error: Error;
            response: any;
        };
        // TODO: 根据opts，更先进的请求
        return new Promise(function (resolve, reject) {
            request({
                encoding: null,
                url,
                method: "GET",
            }, function (error, response) {
                resolve({ error, response } as IResult);
            });
        });
    }

    protected _fire() {
        while(this._STATUS._currentMultiTask < this._OPTION.multiTasking) {
            let task = this._TODOLIST.next();
            if(! task) {
                break;
            } else {
                this.emit("start_a_task");
                if (task.type === TaskType.crawling) {
                    this._asyncCrawling(task)
                        .then(() => {
                            this.emit("done_a_task");
                        })
                        .catch((error) => {
                            console.log(error);
                            this.emit("done_a_task");
                            // TODO: 错误处理
                        });
                }

            }
        }
    }

    protected _loadJq(body: string, task: ITask) {
        let $ = cheerio.load(body);
        // 扩展：添加 url 方法
        // 返回当前节点（们）链接的的绝对路径数组
        // 自动处理了锚和 javascript: void(0)
        $.prototype.url = function () {
            let result = [];
            $(this).each(function () {
                let newUrl = $(this).attr("href");
                // 如果是类似 'javascirpt: void(0)' 的 js 代码，直接跳过
                if (/^javascript/.test(newUrl)) {
                    return false;
                }
                // 如果是锚，等效与当前 url 路径
                if (newUrl && newUrl[0] === "#") {
                    return result.push(task.url);
                }
                // 如果是相对路径，补全路径为绝对路径
                if (newUrl && !/^https?:\/\//.test(newUrl)) {
                    newUrl = url.resolve(task.url, newUrl);
                }
                result.push(newUrl);
            });
            return result;
        };

        const thisSpider = this;
        // 扩展 jQ
        // 添加当前节点（们）链接到 todo-list，自动去重、补全路径
        $.prototype.todo = function (option) {
            let callback = (typeof option === "function") ? option : task.callback;

            let newUrls = $(this).url();
            if (! newUrls) {
                return false;
            }

            newUrls.map((url) => {
                if (url && ! thisSpider.check(url)) {
                    // console.log(url)
                    let new_task = {
                        url,
                        callback,
                        type: TaskType.crawling
                    }
                    if (typeof option === "object") {
                        Object.assign(new_task, option);
                    }
                    thisSpider.addTask(new_task);
                }
            });

        };
        return $;

    }

    protected async _asyncCrawling(currentTask: ITask) {
        let getOption = {};
        let {
            error,
            response
        } = await this.get(currentTask.url, getOption);
        let $;
        if (! error) {
            try {
                // 根据任务设置和全局设置，确定如何编码正文
                let preToUtf8 = this._OPTION.preToUtf8;
                if (currentTask.preToUtf8 !== undefined) {
                    preToUtf8 = currentTask.preToUtf8;
                }
                if (preToUtf8) {
                    let encoding = charset(response.headers, response.body);
                    if (encoding) {
                        response.body = this.decode(response.body, encoding);
                    }
                }

                // 根据任务设置和全局设置，确定是否加载jQ
                if (currentTask.jq !== undefined) {
                    $ = this._loadJq(response.body, currentTask);
                } else if (this._OPTION.jq) {
                    $ = this._loadJq(response.body, currentTask);
                }
            } catch (err) {
                error = err;
            }

        }

        (currentTask as any).response = response;
        (currentTask as any).error = error;

        // currentTask.callback(error, currentTask, $);
        currentTask.callback(error, response, $);

    }

    protected async _asyncDownload(url, opts, path) {
        return new Promise(function (resolve, reject) {
            let download = request(url);
            let write = fs.createWriteStream(path);
            // TODO: 本地空间是否足够 ?
            download.on("error", function (error) {
                reject(error);
            });
            write.on('error', function (error) {
                reject(error);
            });
            download.pipe(write);
            write.on('finish', function () {
                resolve();
            });
        });
    }



    /**
     *
     */
    download(url, opts, path = this._OPTION.download_path, errorCallback) {
        // 让opts变成可选参数
        if (typeof opts === 'string') {
            let x = opts;
            opts = path;
            path = x;
        }

        // TODO: jq选择对象、url数组、相对路径

        //如果是其他协议（比如FTP）

        this._download_list.add({
            url,
            opts,
            callback: null,
            info: {
                path
            }
        });
    }

}

export = NodeSpider;