export interface ICurrent {
    url: string;
    plan: Plan;
    response: any;
    body: any;
    error: Error;
    hasRetried?: number;
}
export type IRule = (err: Error, current: ICurrent) => void;

export interface IPlanInput {
    rule: IRule;
    request?: any;
    use?: any[];
    info?: any;
}

export class Plan {
    public rule: IRule;
    // TODO C 更完善的类型提示
    public request: any;
    public use: any[];
    public info: any;
    // TODO C 包括下面参数的类型
    constructor(rule: IRule, request: any, use: any[], info: any) {
        this.rule = rule;
        this.request = request || null;
        this.use = use || null;
        this.info = info || null;
    }
}

// tslint:disable-next-line:max-classes-per-file
export class DownloadPlan {
    public path: string;
    // TODO C 更完善的类型提示
    public request: any;
    public use: any[];
    public info: any;
    public callback: any;
    constructor(callback, path, request, use, info) {
        this.path = path;
        this.request = request || null;
        this.use = use || null;
        this.info = info || null;
        this.callback = callback;
    }
}