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

export namespace keys {
	
	export class Accelerator {
	    Key: string;
	    Modifiers: string[];
	
	    static createFrom(source: any = {}) {
	        return new Accelerator(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.Key = source["Key"];
	        this.Modifiers = source["Modifiers"];
	    }
	}

}

export namespace main {
	
	export class ClaudePermissions {
	    allow: string[];
	    deny: string[];
	    additionalDirectories: string[];
	
	    static createFrom(source: any = {}) {
	        return new ClaudePermissions(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.allow = source["allow"];
	        this.deny = source["deny"];
	        this.additionalDirectories = source["additionalDirectories"];
	    }
	}
	export class ConversationResult {
	    sessionId: string;
	    messages: types.Message[];
	    totalCount: number;
	    hasMore: boolean;
	
	    static createFrom(source: any = {}) {
	        return new ConversationResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.sessionId = source["sessionId"];
	        this.messages = this.convertValues(source["messages"], types.Message);
	        this.totalCount = source["totalCount"];
	        this.hasMore = source["hasMore"];
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
	export class FileInfo {
	    path: string;
	    relPath: string;
	    name: string;
	    isDir: boolean;
	    size: number;
	    ext: string;
	
	    static createFrom(source: any = {}) {
	        return new FileInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.path = source["path"];
	        this.relPath = source["relPath"];
	        this.name = source["name"];
	        this.isDir = source["isDir"];
	        this.size = source["size"];
	        this.ext = source["ext"];
	    }
	}
	export class ImportResult {
	    found: boolean;
	    hasBlanketBash: boolean;
	    imported?: permissions.ClaudeFuPermissions;
	
	    static createFrom(source: any = {}) {
	        return new ImportResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.found = source["found"];
	        this.hasBlanketBash = source["hasBlanketBash"];
	        this.imported = this.convertValues(source["imported"], permissions.ClaudeFuPermissions);
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
	export class MCPPendingPermission {
	    id: string;
	    agentSlug: string;
	    permission: string;
	    reason: string;
	    createdAt: string;
	
	    static createFrom(source: any = {}) {
	        return new MCPPendingPermission(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.agentSlug = source["agentSlug"];
	        this.permission = source["permission"];
	        this.reason = source["reason"];
	        this.createdAt = source["createdAt"];
	    }
	}
	export class MCPPendingQuestion {
	    id: string;
	    agentSlug: string;
	    questions: any[];
	    createdAt: string;
	
	    static createFrom(source: any = {}) {
	        return new MCPPendingQuestion(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.agentSlug = source["agentSlug"];
	        this.questions = source["questions"];
	        this.createdAt = source["createdAt"];
	    }
	}
	export class PermissionSetMatch {
	    set?: permissions.PermissionSet;
	    baseCommand: string;
	
	    static createFrom(source: any = {}) {
	        return new PermissionSetMatch(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.set = this.convertValues(source["set"], permissions.PermissionSet);
	        this.baseCommand = source["baseCommand"];
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
	export class ScaffoldResult {
	    sessionId: string;
	
	    static createFrom(source: any = {}) {
	        return new ScaffoldResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.sessionId = source["sessionId"];
	    }
	}
	export class UpdateInfo {
	    available: boolean;
	    currentVersion: string;
	    latestVersion: string;
	    releaseUrl: string;
	    releaseNotes: string;
	    publishedAt: string;
	
	    static createFrom(source: any = {}) {
	        return new UpdateInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.available = source["available"];
	        this.currentVersion = source["currentVersion"];
	        this.latestVersion = source["latestVersion"];
	        this.releaseUrl = source["releaseUrl"];
	        this.releaseNotes = source["releaseNotes"];
	        this.publishedAt = source["publishedAt"];
	    }
	}

}

export namespace mcpserver {
	
	export class BacklogItem {
	    id: string;
	    agentId: string;
	    parentId?: string;
	    title: string;
	    context?: string;
	    status: string;
	    tags?: string;
	    createdBy?: string;
	    sortOrder: number;
	    createdAt: number;
	    updatedAt: number;
	
	    static createFrom(source: any = {}) {
	        return new BacklogItem(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.agentId = source["agentId"];
	        this.parentId = source["parentId"];
	        this.title = source["title"];
	        this.context = source["context"];
	        this.status = source["status"];
	        this.tags = source["tags"];
	        this.createdBy = source["createdBy"];
	        this.sortOrder = source["sortOrder"];
	        this.createdAt = source["createdAt"];
	        this.updatedAt = source["updatedAt"];
	    }
	}
	export class InboxMessage {
	    id: string;
	    fromAgentId?: string;
	    fromAgentName: string;
	    toAgentId: string;
	    message: string;
	    priority: string;
	    // Go type: time
	    timestamp: any;
	    read: boolean;
	
	    static createFrom(source: any = {}) {
	        return new InboxMessage(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.fromAgentId = source["fromAgentId"];
	        this.fromAgentName = source["fromAgentName"];
	        this.toAgentId = source["toAgentId"];
	        this.message = source["message"];
	        this.priority = source["priority"];
	        this.timestamp = this.convertValues(source["timestamp"], null);
	        this.read = source["read"];
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
	export class ToolAvailability {
	    agentQuery: boolean;
	    agentMessage: boolean;
	    agentBroadcast: boolean;
	    notifyUser: boolean;
	    askUserQuestion: boolean;
	    selfQuery: boolean;
	    browserAgent: boolean;
	    requestToolPermission: boolean;
	    exitPlanMode: boolean;
	    backlogAdd: boolean;
	    backlogUpdate: boolean;
	    backlogList: boolean;
	
	    static createFrom(source: any = {}) {
	        return new ToolAvailability(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.agentQuery = source["agentQuery"];
	        this.agentMessage = source["agentMessage"];
	        this.agentBroadcast = source["agentBroadcast"];
	        this.notifyUser = source["notifyUser"];
	        this.askUserQuestion = source["askUserQuestion"];
	        this.selfQuery = source["selfQuery"];
	        this.browserAgent = source["browserAgent"];
	        this.requestToolPermission = source["requestToolPermission"];
	        this.exitPlanMode = source["exitPlanMode"];
	        this.backlogAdd = source["backlogAdd"];
	        this.backlogUpdate = source["backlogUpdate"];
	        this.backlogList = source["backlogList"];
	    }
	}
	export class ToolInstructions {
	    agentQuery: string;
	    agentQuerySystemPrompt: string;
	    agentMessage: string;
	    agentBroadcast: string;
	    notifyUser: string;
	    askUserQuestion: string;
	    selfQuery: string;
	    selfQuerySystemPrompt: string;
	    browserAgent: string;
	    requestToolPermission: string;
	    exitPlanMode: string;
	    compactionPrompt: string;
	    compactionContinuation: string;
	    backlogAdd: string;
	    backlogUpdate: string;
	    backlogList: string;
	
	    static createFrom(source: any = {}) {
	        return new ToolInstructions(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.agentQuery = source["agentQuery"];
	        this.agentQuerySystemPrompt = source["agentQuerySystemPrompt"];
	        this.agentMessage = source["agentMessage"];
	        this.agentBroadcast = source["agentBroadcast"];
	        this.notifyUser = source["notifyUser"];
	        this.askUserQuestion = source["askUserQuestion"];
	        this.selfQuery = source["selfQuery"];
	        this.selfQuerySystemPrompt = source["selfQuerySystemPrompt"];
	        this.browserAgent = source["browserAgent"];
	        this.requestToolPermission = source["requestToolPermission"];
	        this.exitPlanMode = source["exitPlanMode"];
	        this.compactionPrompt = source["compactionPrompt"];
	        this.compactionContinuation = source["compactionContinuation"];
	        this.backlogAdd = source["backlogAdd"];
	        this.backlogUpdate = source["backlogUpdate"];
	        this.backlogList = source["backlogList"];
	    }
	}

}

export namespace menu {
	
	export class MenuItem {
	    Label: string;
	    Role: number;
	    Accelerator?: keys.Accelerator;
	    Type: string;
	    Disabled: boolean;
	    Hidden: boolean;
	    Checked: boolean;
	    SubMenu?: Menu;
	
	    static createFrom(source: any = {}) {
	        return new MenuItem(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.Label = source["Label"];
	        this.Role = source["Role"];
	        this.Accelerator = this.convertValues(source["Accelerator"], keys.Accelerator);
	        this.Type = source["Type"];
	        this.Disabled = source["Disabled"];
	        this.Hidden = source["Hidden"];
	        this.Checked = source["Checked"];
	        this.SubMenu = this.convertValues(source["SubMenu"], Menu);
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
	export class Menu {
	    Items: MenuItem[];
	
	    static createFrom(source: any = {}) {
	        return new Menu(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.Items = this.convertValues(source["Items"], MenuItem);
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

export namespace permissions {
	
	export class ToolPermission {
	    common: string[];
	    permissive: string[];
	    yolo: string[];
	
	    static createFrom(source: any = {}) {
	        return new ToolPermission(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.common = source["common"];
	        this.permissive = source["permissive"];
	        this.yolo = source["yolo"];
	    }
	}
	export class ClaudeFuPermissions {
	    version: number;
	    inheritFromGlobal?: boolean;
	    toolPermissions: Record<string, ToolPermission>;
	    additionalDirectories: string[];
	    experimentalFeatures?: Record<string, boolean>;
	
	    static createFrom(source: any = {}) {
	        return new ClaudeFuPermissions(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.version = source["version"];
	        this.inheritFromGlobal = source["inheritFromGlobal"];
	        this.toolPermissions = this.convertValues(source["toolPermissions"], ToolPermission, true);
	        this.additionalDirectories = source["additionalDirectories"];
	        this.experimentalFeatures = source["experimentalFeatures"];
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
	export class ExperimentalFeatureDefinition {
	    id: string;
	    name: string;
	    description: string;
	    envVar: string;
	    tools: string[];
	
	    static createFrom(source: any = {}) {
	        return new ExperimentalFeatureDefinition(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.description = source["description"];
	        this.envVar = source["envVar"];
	        this.tools = source["tools"];
	    }
	}
	export class ExperimentalFeatureStatus {
	    feature: ExperimentalFeatureDefinition;
	    detected: boolean;
	    source: string;
	
	    static createFrom(source: any = {}) {
	        return new ExperimentalFeatureStatus(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.feature = this.convertValues(source["feature"], ExperimentalFeatureDefinition);
	        this.detected = source["detected"];
	        this.source = source["source"];
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
	export class PermissionTiers {
	    common: string[];
	    permissive: string[];
	    yolo: string[];
	
	    static createFrom(source: any = {}) {
	        return new PermissionTiers(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.common = source["common"];
	        this.permissive = source["permissive"];
	        this.yolo = source["yolo"];
	    }
	}
	export class PermissionSet {
	    id: string;
	    name: string;
	    description?: string;
	    permissions: PermissionTiers;
	
	    static createFrom(source: any = {}) {
	        return new PermissionSet(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.description = source["description"];
	        this.permissions = this.convertValues(source["permissions"], PermissionTiers);
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
	
	export class PermissionsDiff {
	    toolsAdded: string[];
	    toolsRemoved: string[];
	    hasChanges: boolean;
	
	    static createFrom(source: any = {}) {
	        return new PermissionsDiff(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.toolsAdded = source["toolsAdded"];
	        this.toolsRemoved = source["toolsRemoved"];
	        this.hasChanges = source["hasChanges"];
	    }
	}

}

export namespace scaffold {
	
	export class ScaffoldCheck {
	    hasProjectsDir: boolean;
	    hasSessions: boolean;
	    hasClaudeMD: boolean;
	    hasPermissions: boolean;
	
	    static createFrom(source: any = {}) {
	        return new ScaffoldCheck(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.hasProjectsDir = source["hasProjectsDir"];
	        this.hasSessions = source["hasSessions"];
	        this.hasClaudeMD = source["hasClaudeMD"];
	        this.hasPermissions = source["hasPermissions"];
	    }
	}
	export class ScaffoldOptions {
	    projectsDir: boolean;
	    claudeMD: boolean;
	    permissions: boolean;
	
	    static createFrom(source: any = {}) {
	        return new ScaffoldOptions(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.projectsDir = source["projectsDir"];
	        this.claudeMD = source["claudeMD"];
	        this.permissions = source["permissions"];
	    }
	}

}

export namespace settings {
	
	export class Settings {
	    theme: string;
	    enterBehavior: string;
	    defaultWorkingDir: string;
	    debugLogging: boolean;
	    claudeEnvVars: Record<string, string>;
	    defaultPermissionSets: Record<string, string>;
	
	    static createFrom(source: any = {}) {
	        return new Settings(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.theme = source["theme"];
	        this.enterBehavior = source["enterBehavior"];
	        this.defaultWorkingDir = source["defaultWorkingDir"];
	        this.debugLogging = source["debugLogging"];
	        this.claudeEnvVars = source["claudeEnvVars"];
	        this.defaultPermissionSets = source["defaultPermissionSets"];
	    }
	}

}

export namespace terminal {
	
	export class TerminalInfo {
	    id: string;
	    label: string;
	    folder: string;
	
	    static createFrom(source: any = {}) {
	        return new TerminalInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.label = source["label"];
	        this.folder = source["folder"];
	    }
	}

}

export namespace types {
	
	export class Attachment {
	    type: string;
	    media_type: string;
	    data: string;
	    filePath?: string;
	    fileName?: string;
	    extension?: string;
	
	    static createFrom(source: any = {}) {
	        return new Attachment(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.type = source["type"];
	        this.media_type = source["media_type"];
	        this.data = source["data"];
	        this.filePath = source["filePath"];
	        this.fileName = source["fileName"];
	        this.extension = source["extension"];
	    }
	}
	export class CacheCreation {
	    ephemeral_5m_input_tokens: number;
	    ephemeral_1h_input_tokens: number;
	
	    static createFrom(source: any = {}) {
	        return new CacheCreation(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.ephemeral_5m_input_tokens = source["ephemeral_5m_input_tokens"];
	        this.ephemeral_1h_input_tokens = source["ephemeral_1h_input_tokens"];
	    }
	}
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
	    is_error: boolean;
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
	
	export class TokenUsage {
	    input_tokens: number;
	    output_tokens: number;
	    cache_creation_input_tokens: number;
	    cache_read_input_tokens: number;
	    service_tier?: string;
	    cache_creation?: CacheCreation;
	
	    static createFrom(source: any = {}) {
	        return new TokenUsage(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.input_tokens = source["input_tokens"];
	        this.output_tokens = source["output_tokens"];
	        this.cache_creation_input_tokens = source["cache_creation_input_tokens"];
	        this.cache_read_input_tokens = source["cache_read_input_tokens"];
	        this.service_tier = source["service_tier"];
	        this.cache_creation = this.convertValues(source["cache_creation"], CacheCreation);
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
	export class PendingQuestion {
	    toolUseId: string;
	    questions: any[];
	
	    static createFrom(source: any = {}) {
	        return new PendingQuestion(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.toolUseId = source["toolUseId"];
	        this.questions = source["questions"];
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
	    pendingQuestion?: PendingQuestion;
	    isSynthetic?: boolean;
	    stopReason?: string;
	    usage?: TokenUsage;
	    slug?: string;
	
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
	        this.pendingQuestion = this.convertValues(source["pendingQuestion"], PendingQuestion);
	        this.isSynthetic = source["isSynthetic"];
	        this.stopReason = source["stopReason"];
	        this.usage = this.convertValues(source["usage"], TokenUsage);
	        this.slug = source["slug"];
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
	    mcpSlug?: string;
	    mcpEnabled?: boolean;
	    mcpDescription?: string;
	
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
	        this.mcpSlug = source["mcpSlug"];
	        this.mcpEnabled = source["mcpEnabled"];
	        this.mcpDescription = source["mcpDescription"];
	    }
	}
	export class MCPConfig {
	    enabled: boolean;
	    port: number;
	
	    static createFrom(source: any = {}) {
	        return new MCPConfig(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.enabled = source["enabled"];
	        this.port = source["port"];
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
	    mcpConfig?: MCPConfig;
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
	        this.mcpConfig = this.convertValues(source["mcpConfig"], MCPConfig);
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

