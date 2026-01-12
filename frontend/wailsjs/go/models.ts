export namespace auth {
	
	export class AuthStatus {
	    isAuthenticated: boolean;
	    authMethod: string;
	    hasApiKey: boolean;
	    hasHyper: boolean;
	    hasClaudeCode: boolean;
	    claudeCodeSubscription: string;
	
	    static createFrom(source: any = {}) {
	        return new AuthStatus(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.isAuthenticated = source["isAuthenticated"];
	        this.authMethod = source["authMethod"];
	        this.hasApiKey = source["hasApiKey"];
	        this.hasHyper = source["hasHyper"];
	        this.hasClaudeCode = source["hasClaudeCode"];
	        this.claudeCodeSubscription = source["claudeCodeSubscription"];
	    }
	}
	export class DeviceAuthInfo {
	    deviceCode: string;
	    userCode: string;
	    verificationUrl: string;
	    expiresIn: number;
	
	    static createFrom(source: any = {}) {
	        return new DeviceAuthInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.deviceCode = source["deviceCode"];
	        this.userCode = source["userCode"];
	        this.verificationUrl = source["verificationUrl"];
	        this.expiresIn = source["expiresIn"];
	    }
	}

}

export namespace settings {
	
	export class Settings {
	    theme: string;
	    enterBehavior: string;
	    defaultWorkingDir: string;
	
	    static createFrom(source: any = {}) {
	        return new Settings(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.theme = source["theme"];
	        this.enterBehavior = source["enterBehavior"];
	        this.defaultWorkingDir = source["defaultWorkingDir"];
	    }
	}

}

export namespace types {
	
	export class ImageSource {
	    type: string;
	    media_type: string;
	    data: string;
	
	    static createFrom(source: any = {}) {
	        return new ImageSource(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.type = source["type"];
	        this.media_type = source["media_type"];
	        this.data = source["data"];
	    }
	}
	export class ContentBlock {
	    type: string;
	    text?: string;
	    id?: string;
	    name?: string;
	    input?: any;
	    tool_use_id?: string;
	    content?: any;
	    is_error?: boolean;
	    source?: ImageSource;
	    thinking?: string;
	    signature?: string;
	
	    static createFrom(source: any = {}) {
	        return new ContentBlock(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.type = source["type"];
	        this.text = source["text"];
	        this.id = source["id"];
	        this.name = source["name"];
	        this.input = source["input"];
	        this.tool_use_id = source["tool_use_id"];
	        this.content = source["content"];
	        this.is_error = source["is_error"];
	        this.source = this.convertValues(source["source"], ImageSource);
	        this.thinking = source["thinking"];
	        this.signature = source["signature"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	export class Message {
	    uuid: string;
	    type: string;
	    content: string;
	    contentBlocks?: ContentBlock[];
	    timestamp: string;
	    isCompaction?: boolean;
	    compactionPreview?: string;
	
	    static createFrom(source: any = {}) {
	        return new Message(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.uuid = source["uuid"];
	        this.type = source["type"];
	        this.content = source["content"];
	        this.contentBlocks = this.convertValues(source["contentBlocks"], ContentBlock);
	        this.timestamp = source["timestamp"];
	        this.isCompaction = source["isCompaction"];
	        this.compactionPreview = source["compactionPreview"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class Session {
	    id: string;
	    agentId: string;
	    preview: string;
	    messageCount: number;
	    // Go type: time
	    createdAt: any;
	    // Go type: time
	    updatedAt: any;
	
	    static createFrom(source: any = {}) {
	        return new Session(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.agentId = source["agentId"];
	        this.preview = source["preview"];
	        this.messageCount = source["messageCount"];
	        this.createdAt = this.convertValues(source["createdAt"], null);
	        this.updatedAt = this.convertValues(source["updatedAt"], null);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

}

export namespace workspace {
	
	export class Agent {
	    id: string;
	    name: string;
	    folder: string;
	    watchMode?: string;
	    selectedSessionId?: string;
	    provider?: string;
	    specialization?: string;
	    claudeMdPath?: string;
	
	    static createFrom(source: any = {}) {
	        return new Agent(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.folder = source["folder"];
	        this.watchMode = source["watchMode"];
	        this.selectedSessionId = source["selectedSessionId"];
	        this.provider = source["provider"];
	        this.specialization = source["specialization"];
	        this.claudeMdPath = source["claudeMdPath"];
	    }
	}
	export class SelectedSession {
	    agentId?: string;
	    sessionId?: string;
	    folder?: string;
	
	    static createFrom(source: any = {}) {
	        return new SelectedSession(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.agentId = source["agentId"];
	        this.sessionId = source["sessionId"];
	        this.folder = source["folder"];
	    }
	}
	export class Workspace {
	    version: number;
	    id: string;
	    name: string;
	    agents: Agent[];
	    selectedSession?: SelectedSession;
	    // Go type: time
	    created: any;
	    // Go type: time
	    lastOpened: any;
	
	    static createFrom(source: any = {}) {
	        return new Workspace(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.version = source["version"];
	        this.id = source["id"];
	        this.name = source["name"];
	        this.agents = this.convertValues(source["agents"], Agent);
	        this.selectedSession = this.convertValues(source["selectedSession"], SelectedSession);
	        this.created = this.convertValues(source["created"], null);
	        this.lastOpened = this.convertValues(source["lastOpened"], null);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class WorkspaceSummary {
	    id: string;
	    name: string;
	    // Go type: time
	    lastOpened: any;
	
	    static createFrom(source: any = {}) {
	        return new WorkspaceSummary(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.lastOpened = this.convertValues(source["lastOpened"], null);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

}

