package permissions

// PermissionSet defines a grouped set of bash permissions with risk tiers
type PermissionSet struct {
	ID          string          `json:"id"`
	Name        string          `json:"name"`
	Description string          `json:"description,omitempty"`
	Permissions PermissionTiers `json:"permissions"`
}

// PermissionTiers groups permissions by risk level
type PermissionTiers struct {
	Common     []string `json:"common"`     // 🟢 Everyday read-only commands
	Permissive []string `json:"permissive"` // 🟡 Modifies local state
	YOLO       []string `json:"yolo"`       // 🔴 Remote/irreversible operations
}

// RiskLevel represents the risk tier of a permission
type RiskLevel string

const (
	RiskCommon     RiskLevel = "common"
	RiskPermissive RiskLevel = "permissive"
	RiskYOLO       RiskLevel = "yolo"
)

// BuiltInSets returns all built-in permission sets
func BuiltInSets() map[string]PermissionSet {
	return map[string]PermissionSet{
		"claude-builtin": claudeBuiltinSet(),
		"files":          filesSet(),
		"search":         searchSet(),
		"git":            gitSet(),
		"github":         githubSet(),
		"go":             goSet(),
		"node":           nodeSet(),
		"rust":           rustSet(),
		"python":         pythonSet(),
		"docker":         dockerSet(),
		"make":           makeSet(),
		"network":        networkSet(),
		"database":       databaseSet(),
		"deploy":         deploySet(),
		"system":         systemSet(),
		"custom":         customSet(),
	}
}

// GetOrderedSetIDs returns set IDs in the display order for the UI
// Fixed order: claude-builtin, files, search first, then alphabetical, custom last
func GetOrderedSetIDs() []string {
	return []string{
		"claude-builtin", "files", "search", "git", "github", // Fixed order first
		"database", "deploy", "docker", "go", "make", "network", "node", "python", "rust", "system", // Alphabetical
		"custom", // Custom always last
	}
}

// GetSetByID returns a permission set by its ID, or nil if not found
func GetSetByID(id string) *PermissionSet {
	sets := BuiltInSets()
	if set, ok := sets[id]; ok {
		return &set
	}
	return nil
}

// claudeBuiltinSet returns the Claude Built-in Tools permission set
// This controls which Claude Code tools (not Bash patterns) are available
func claudeBuiltinSet() PermissionSet {
	return PermissionSet{
		ID:          "claude-builtin",
		Name:        "Claude Built-in Tools",
		Description: "Core Claude Code tools (excluding Bash - see other sets for Bash patterns)",
		Permissions: PermissionTiers{
			Common: []string{
				// Read-only tools - safe to always enable
				"Read", "Glob", "Grep", "WebSearch", "WebFetch",
				"LSP", "TodoWrite", "TaskOutput", "KillShell",
			},
			Permissive: []string{
				// Write/modify tools - can change files
				"Write", "Edit", "NotebookEdit",
				// Agent/workflow tools
				"Task", "Skill", "EnterPlanMode",
			},
			YOLO: []string{
				// Blanket Bash - typically users should use specific sets
				// (git, files, etc.) with patterns instead for safer control
				"Bash",
			},
		},
	}
}

// gitSet returns the Git permission set
func gitSet() PermissionSet {
	return PermissionSet{
		ID:          "git",
		Name:        "Git",
		Description: "Version control operations",
		Permissions: PermissionTiers{
			Common: []string{
				"Bash(git status:*)",
				"Bash(git log:*)",
				"Bash(git diff:*)",
				"Bash(git branch:*)",
				"Bash(git show:*)",
				"Bash(git remote -v:*)",
				"Bash(git tag -l:*)",
				"Bash(git describe:*)",
				"Bash(git rev-parse:*)",
				"Bash(git config --get:*)",
				"Bash(git ls-files:*)",
				"Bash(git blame:*)",
				"Bash(git shortlog:*)",
				"Bash(git -C:*)",
			},
			Permissive: []string{
				"Bash(git add:*)",
				"Bash(git commit:*)",
				"Bash(git stash:*)",
				"Bash(git tag:*)",
				"Bash(git fetch:*)",
				"Bash(git merge:*)",
				"Bash(git pull:*)",
				"Bash(git branch -d:*)",
				"Bash(git branch -D:*)",
				"Bash(git worktree:*)",
				"Bash(git switch:*)",
				"Bash(git restore:*)",
				"Bash(git mv:*)",
			},
			YOLO: []string{
				"Bash(git push:*)",
				"Bash(git reset:*)",
				"Bash(git checkout:*)",
				"Bash(git rebase:*)",
				"Bash(git cherry-pick:*)",
				"Bash(git revert:*)",
				"Bash(git clean:*)",
				"Bash(git push --force:*)",
			},
		},
	}
}

// githubSet returns the GitHub CLI permission set
func githubSet() PermissionSet {
	return PermissionSet{
		ID:          "github",
		Name:        "GitHub CLI",
		Description: "GitHub CLI (gh) operations",
		Permissions: PermissionTiers{
			Common: []string{
				"Bash(gh pr list:*)",
				"Bash(gh pr view:*)",
				"Bash(gh pr status:*)",
				"Bash(gh pr checks:*)",
				"Bash(gh pr diff:*)",
				"Bash(gh issue list:*)",
				"Bash(gh issue view:*)",
				"Bash(gh issue status:*)",
				"Bash(gh run list:*)",
				"Bash(gh run view:*)",
				"Bash(gh repo view:*)",
				"Bash(gh release list:*)",
				"Bash(gh release view:*)",
				"Bash(gh api:*)",
				"Bash(gh auth status:*)",
				"Bash(gh status:*)",
			},
			Permissive: []string{
				"Bash(gh pr create:*)",
				"Bash(gh pr edit:*)",
				"Bash(gh pr comment:*)",
				"Bash(gh pr review:*)",
				"Bash(gh pr checkout:*)",
				"Bash(gh pr merge:*)",
				"Bash(gh issue create:*)",
				"Bash(gh issue edit:*)",
				"Bash(gh issue comment:*)",
				"Bash(gh issue close:*)",
				"Bash(gh run rerun:*)",
				"Bash(gh run watch:*)",
				"Bash(gh label:*)",
			},
			YOLO: []string{
				"Bash(gh pr close:*)",
				"Bash(gh issue delete:*)",
				"Bash(gh release create:*)",
				"Bash(gh release delete:*)",
				"Bash(gh repo create:*)",
				"Bash(gh repo delete:*)",
				"Bash(gh run cancel:*)",
			},
		},
	}
}

// nodeSet returns the Node.js/NPM permission set
func nodeSet() PermissionSet {
	return PermissionSet{
		ID:          "node",
		Name:        "Node/NPM",
		Description: "Node.js, NPM, Yarn, pnpm, and npx",
		Permissions: PermissionTiers{
			Common: []string{
				"Bash(npm list:*)",
				"Bash(npm outdated:*)",
				"Bash(npm view:*)",
				"Bash(npm search:*)",
				"Bash(npm info:*)",
				"Bash(npm ls:*)",
				"Bash(yarn list:*)",
				"Bash(yarn info:*)",
				"Bash(yarn why:*)",
				"Bash(pnpm list:*)",
				"Bash(node --version:*)",
				"Bash(npm --version:*)",
				"Bash(npx tsc --version:*)",
			},
			Permissive: []string{
				"Bash(npm install:*)",
				"Bash(npm update:*)",
				"Bash(npm run:*)",
				"Bash(npm test:*)",
				"Bash(npm start:*)",
				"Bash(npm build:*)",
				"Bash(npm ci:*)",
				"Bash(npm init:*)",
				"Bash(yarn install:*)",
				"Bash(yarn add:*)",
				"Bash(yarn:*)",
				"Bash(pnpm install:*)",
				"Bash(pnpm add:*)",
				"Bash(npx:*)",
				"Bash(npx tsc:*)",
				"Bash(npx create-next-app:*)",
				"Bash(npx prisma:*)",
				"Bash(npx eslint:*)",
				"Bash(npx prettier:*)",
				"Bash(node:*)",
			},
			YOLO: []string{
				"Bash(npm publish:*)",
				"Bash(npm unpublish:*)",
				"Bash(npm deprecate:*)",
				"Bash(yarn publish:*)",
				"Bash(pnpm publish:*)",
			},
		},
	}
}

// goSet returns the Go permission set
func goSet() PermissionSet {
	return PermissionSet{
		ID:          "go",
		Name:        "Go",
		Description: "Go toolchain operations",
		Permissions: PermissionTiers{
			Common: []string{
				"Bash(go list:*)",
				"Bash(go doc:*)",
				"Bash(go vet:*)",
				"Bash(go version:*)",
				"Bash(go env:*)",
				"Bash(go mod graph:*)",
				"Bash(go mod why:*)",
				"Bash(gofmt -d:*)",
			},
			Permissive: []string{
				"Bash(go build:*)",
				"Bash(go test:*)",
				"Bash(go mod tidy:*)",
				"Bash(go mod download:*)",
				"Bash(go mod init:*)",
				"Bash(go generate:*)",
				"Bash(go fmt:*)",
				"Bash(go get:*)",
				"Bash(go work:*)",
				"Bash(gofmt -w:*)",
				"Bash(go mod:*)",
			},
			YOLO: []string{
				"Bash(go install:*)",
				"Bash(go clean:*)",
				"Bash(go run:*)",
			},
		},
	}
}

// rustSet returns the Rust permission set
func rustSet() PermissionSet {
	return PermissionSet{
		ID:          "rust",
		Name:        "Rust",
		Description: "Rust toolchain (cargo, rustc, rustup)",
		Permissions: PermissionTiers{
			Common: []string{
				"Bash(cargo --version:*)",
				"Bash(cargo check:*)",
				"Bash(cargo doc:*)",
				"Bash(cargo tree:*)",
				"Bash(cargo metadata:*)",
				"Bash(cargo search:*)",
				"Bash(cargo audit:*)",
				"Bash(rustc --version:*)",
				"Bash(rustup show:*)",
				"Bash(rustup toolchain list:*)",
				"Bash(cargo clippy:*)",
			},
			Permissive: []string{
				"Bash(cargo build:*)",
				"Bash(cargo test:*)",
				"Bash(cargo fmt:*)",
				"Bash(cargo add:*)",
				"Bash(cargo remove:*)",
				"Bash(cargo update:*)",
				"Bash(cargo new:*)",
				"Bash(cargo init:*)",
				"Bash(cargo fix:*)",
				"Bash(cargo bench:*)",
				"Bash(rustup update:*)",
				"Bash(rustup component:*)",
			},
			YOLO: []string{
				"Bash(cargo install:*)",
				"Bash(cargo publish:*)",
				"Bash(cargo run:*)",
				"Bash(cargo clean:*)",
				"Bash(rustup toolchain install:*)",
			},
		},
	}
}

// pythonSet returns the Python permission set
func pythonSet() PermissionSet {
	return PermissionSet{
		ID:          "python",
		Name:        "Python",
		Description: "Python, pip, and poetry operations",
		Permissions: PermissionTiers{
			Common: []string{
				"Bash(pip list:*)",
				"Bash(pip show:*)",
				"Bash(pip freeze:*)",
				"Bash(pip check:*)",
				"Bash(python --version:*)",
				"Bash(python3 --version:*)",
				"Bash(pip --version:*)",
				"Bash(pip3 --version:*)",
				"Bash(poetry show:*)",
				"Bash(poetry env info:*)",
				"Bash(uv --version:*)",
			},
			Permissive: []string{
				"Bash(pip install:*)",
				"Bash(pip3 install:*)",
				"Bash(pip install -r:*)",
				"Bash(python -m venv:*)",
				"Bash(python3 -m venv:*)",
				"Bash(poetry install:*)",
				"Bash(poetry add:*)",
				"Bash(poetry update:*)",
				"Bash(pytest:*)",
				"Bash(python -m pytest:*)",
				"Bash(uv pip install:*)",
				"Bash(uv sync:*)",
				"Bash(uv add:*)",
			},
			YOLO: []string{
				"Bash(pip uninstall:*)",
				"Bash(python:*)",
				"Bash(python3:*)",
				"Bash(twine:*)",
			},
		},
	}
}

// filesSet returns the File Utilities permission set
func filesSet() PermissionSet {
	return PermissionSet{
		ID:          "files",
		Name:        "File Utilities",
		Description: "File system operations and text processing",
		Permissions: PermissionTiers{
			Common: []string{
				"Bash(ls:*)",
				"Bash(cat:*)",
				"Bash(head:*)",
				"Bash(tail:*)",
				"Bash(wc:*)",
				"Bash(file:*)",
				"Bash(stat:*)",
				"Bash(du:*)",
				"Bash(df:*)",
				"Bash(find:*)",
				"Bash(grep:*)",
				"Bash(tree:*)",
				"Bash(pwd:*)",
				"Bash(diff:*)",
				"Bash(sort:*)",
				"Bash(uniq:*)",
				"Bash(echo:*)",
				"Bash(printf:*)",
				"Bash(basename:*)",
				"Bash(dirname:*)",
				"Bash(realpath:*)",
				"Bash(readlink:*)",
			},
			Permissive: []string{
				"Bash(cp:*)",
				"Bash(mv:*)",
				"Bash(mkdir:*)",
				"Bash(touch:*)",
				"Bash(ln:*)",
				"Bash(tar:*)",
				"Bash(unzip:*)",
				"Bash(zip:*)",
				"Bash(sed:*)",
				"Bash(awk:*)",
				"Bash(xargs:*)",
				"Bash(tee:*)",
				"Bash(patch:*)",
			},
			YOLO: []string{
				"Bash(rm:*)",
				"Bash(rm -rf:*)",
				"Bash(chmod:*)",
				"Bash(chown:*)",
				"Bash(rmdir:*)",
			},
		},
	}
}

// searchSet returns the Search & Transform permission set
func searchSet() PermissionSet {
	return PermissionSet{
		ID:          "search",
		Name:        "Search & Transform",
		Description: "Advanced search, JSON/YAML processing, data tools",
		Permissions: PermissionTiers{
			Common: []string{
				"Bash(rg:*)",
				"Bash(fd:*)",
				"Bash(ag:*)",
				"Bash(fzf:*)",
				"Bash(jq:*)",
				"Bash(yq:*)",
				"Bash(cut:*)",
				"Bash(tr:*)",
				"Bash(column:*)",
				"Bash(less:*)",
				"Bash(more:*)",
				"Bash(xxd:*)",
				"Bash(hexdump:*)",
				"Bash(md5:*)",
				"Bash(shasum:*)",
				"Bash(base64:*)",
			},
			Permissive: []string{},
			YOLO:       []string{},
		},
	}
}

// networkSet returns the Network Tools permission set
func networkSet() PermissionSet {
	return PermissionSet{
		ID:          "network",
		Name:        "Network",
		Description: "HTTP, DNS, and connectivity tools",
		Permissions: PermissionTiers{
			Common: []string{
				"Bash(curl:*)",
				"Bash(wget:*)",
				"Bash(dig:*)",
				"Bash(nslookup:*)",
				"Bash(ping:*)",
				"Bash(host:*)",
				"Bash(whois:*)",
				"Bash(nc:*)",
				"Bash(netstat:*)",
				"Bash(lsof -i:*)",
				"Bash(ifconfig:*)",
				"Bash(openssl:*)",
			},
			Permissive: []string{
				"Bash(ssh:*)",
				"Bash(scp:*)",
				"Bash(rsync:*)",
				"Bash(httpie:*)",
			},
			YOLO: []string{},
		},
	}
}

// databaseSet returns the Database Tools permission set
func databaseSet() PermissionSet {
	return PermissionSet{
		ID:          "database",
		Name:        "Database",
		Description: "Database CLIs and migration tools",
		Permissions: PermissionTiers{
			Common: []string{
				"Bash(sqlite3:*)",
				"Bash(psql:*)",
				"Bash(mysql:*)",
				"Bash(redis-cli:*)",
				"Bash(mongosh:*)",
			},
			Permissive: []string{
				"Bash(./db-query:*)",
				"Bash(./db-migrate:*)",
				"Bash(prisma:*)",
				"Bash(npx prisma db:*)",
				"Bash(npx prisma migrate:*)",
				"Bash(npx prisma generate:*)",
				"Bash(diesel:*)",
				"Bash(sqlx:*)",
			},
			YOLO: []string{
				"Bash(dropdb:*)",
				"Bash(createdb:*)",
				"Bash(pg_dump:*)",
				"Bash(pg_restore:*)",
				"Bash(mysqldump:*)",
			},
		},
	}
}

// deploySet returns the Deployment Tools permission set
func deploySet() PermissionSet {
	return PermissionSet{
		ID:          "deploy",
		Name:        "Deploy",
		Description: "Deployment and infrastructure tools",
		Permissions: PermissionTiers{
			Common: []string{
				"Bash(fly status:*)",
				"Bash(fly apps list:*)",
				"Bash(fly logs:*)",
				"Bash(fly info:*)",
				"Bash(flyctl status:*)",
				"Bash(flyctl apps list:*)",
				"Bash(kubectl get:*)",
				"Bash(kubectl describe:*)",
				"Bash(kubectl logs:*)",
				"Bash(terraform plan:*)",
				"Bash(terraform show:*)",
				"Bash(helm list:*)",
				"Bash(helm status:*)",
				"Bash(vercel ls:*)",
				"Bash(netlify status:*)",
			},
			Permissive: []string{
				"Bash(fly deploy:*)",
				"Bash(flyctl deploy:*)",
				"Bash(fly:*)",
				"Bash(flyctl:*)",
				"Bash(kubectl apply:*)",
				"Bash(terraform apply:*)",
				"Bash(helm install:*)",
				"Bash(helm upgrade:*)",
				"Bash(vercel:*)",
				"Bash(netlify deploy:*)",
			},
			YOLO: []string{
				"Bash(fly destroy:*)",
				"Bash(flyctl destroy:*)",
				"Bash(kubectl delete:*)",
				"Bash(terraform destroy:*)",
				"Bash(helm uninstall:*)",
			},
		},
	}
}

// dockerSet returns the Docker permission set
func dockerSet() PermissionSet {
	return PermissionSet{
		ID:          "docker",
		Name:        "Docker",
		Description: "Container operations",
		Permissions: PermissionTiers{
			Common: []string{
				"Bash(docker ps:*)",
				"Bash(docker images:*)",
				"Bash(docker logs:*)",
				"Bash(docker inspect:*)",
				"Bash(docker version:*)",
				"Bash(docker info:*)",
				"Bash(docker stats:*)",
				"Bash(docker top:*)",
				"Bash(docker-compose ps:*)",
				"Bash(docker-compose logs:*)",
				"Bash(docker compose ps:*)",
				"Bash(docker compose logs:*)",
			},
			Permissive: []string{
				"Bash(docker build:*)",
				"Bash(docker run:*)",
				"Bash(docker exec:*)",
				"Bash(docker start:*)",
				"Bash(docker stop:*)",
				"Bash(docker restart:*)",
				"Bash(docker-compose up:*)",
				"Bash(docker-compose down:*)",
				"Bash(docker-compose build:*)",
				"Bash(docker compose up:*)",
				"Bash(docker compose down:*)",
				"Bash(docker compose build:*)",
				"Bash(docker pull:*)",
			},
			YOLO: []string{
				"Bash(docker rm:*)",
				"Bash(docker rmi:*)",
				"Bash(docker push:*)",
				"Bash(docker system prune:*)",
				"Bash(docker volume rm:*)",
				"Bash(docker network rm:*)",
			},
		},
	}
}

// makeSet returns the Make/Build permission set
func makeSet() PermissionSet {
	return PermissionSet{
		ID:          "make",
		Name:        "Make/Build",
		Description: "Build systems (make, cmake, buf)",
		Permissions: PermissionTiers{
			Common: []string{
				"Bash(make --dry-run:*)",
				"Bash(make -n:*)",
				"Bash(make --version:*)",
				"Bash(make help:*)",
				"Bash(cmake --version:*)",
				"Bash(buf --version:*)",
			},
			Permissive: []string{
				"Bash(make:*)",
				"Bash(make build:*)",
				"Bash(make test:*)",
				"Bash(make lint:*)",
				"Bash(make check:*)",
				"Bash(make all:*)",
				"Bash(cmake:*)",
				"Bash(buf:*)",
				"Bash(buf generate:*)",
				"Bash(buf lint:*)",
				"Bash(buf build:*)",
			},
			YOLO: []string{
				"Bash(make clean:*)",
				"Bash(make install:*)",
				"Bash(make deploy:*)",
			},
		},
	}
}

// systemSet returns the System Tools permission set
func systemSet() PermissionSet {
	return PermissionSet{
		ID:          "system",
		Name:        "System",
		Description: "Package managers, environment, and system info",
		Permissions: PermissionTiers{
			Common: []string{
				"Bash(which:*)",
				"Bash(whereis:*)",
				"Bash(env:*)",
				"Bash(printenv:*)",
				"Bash(whoami:*)",
				"Bash(uname:*)",
				"Bash(hostname:*)",
				"Bash(uptime:*)",
				"Bash(date:*)",
				"Bash(id:*)",
				"Bash(ps:*)",
				"Bash(top -l:*)",
				"Bash(sw_vers:*)",
				"Bash(arch:*)",
				"Bash(brew list:*)",
				"Bash(brew info:*)",
				"Bash(brew search:*)",
				"Bash(brew outdated:*)",
				"Bash(brew --version:*)",
			},
			Permissive: []string{
				"Bash(brew install:*)",
				"Bash(brew update:*)",
				"Bash(brew upgrade:*)",
				"Bash(brew tap:*)",
				"Bash(brew services:*)",
				"Bash(export:*)",
				"Bash(source:*)",
				"Bash(./dev:*)",
				"Bash(dev:*)",
			},
			YOLO: []string{
				"Bash(brew uninstall:*)",
				"Bash(brew remove:*)",
				"Bash(kill:*)",
				"Bash(killall:*)",
				"Bash(sudo:*)",
			},
		},
	}
}

// customSet returns the Custom permission set for user-defined Bash patterns
// This allows users to add arbitrary Bash permissions not covered by other sets
func customSet() PermissionSet {
	return PermissionSet{
		ID:          "custom",
		Name:        "Custom",
		Description: "Add your own Bash patterns (e.g., wails, protoc, etc.)",
		Permissions: PermissionTiers{
			// Empty defaults - users add their own via the UI
			Common:     []string{},
			Permissive: []string{},
			YOLO:       []string{},
		},
	}
}

// GetSetByCommand finds a permission set that matches the given command
// Returns the set and which permissions match, or nil if no match
func GetSetByCommand(command string) (*PermissionSet, string) {
	// Extract the base command (first word)
	baseCmd := command
	if idx := indexOf(command, ' '); idx != -1 {
		baseCmd = command[:idx]
	}

	sets := BuiltInSets()

	// Map base commands to set IDs
	commandToSet := map[string]string{
		// Git
		"git": "git",
		// GitHub CLI
		"gh": "github",
		// Node
		"npm": "node", "yarn": "node", "pnpm": "node", "npx": "node", "node": "node",
		// Go
		"go": "go", "gofmt": "go",
		// Rust
		"cargo": "rust", "rustc": "rust", "rustup": "rust",
		// Python
		"python": "python", "python3": "python", "pip": "python", "pip3": "python",
		"poetry": "python", "pytest": "python", "uv": "python", "twine": "python",
		// Files
		"ls": "files", "cat": "files", "head": "files", "tail": "files",
		"cp": "files", "mv": "files", "rm": "files", "mkdir": "files",
		"find": "files", "grep": "files", "tree": "files", "echo": "files",
		"sed": "files", "awk": "files", "diff": "files", "sort": "files",
		"touch": "files", "tar": "files", "unzip": "files", "zip": "files",
		// Search
		"rg": "search", "fd": "search", "ag": "search", "fzf": "search",
		"jq": "search", "yq": "search", "cut": "search", "tr": "search",
		// Docker
		"docker": "docker", "docker-compose": "docker",
		// Make
		"make": "make", "cmake": "make", "buf": "make",
		// Network
		"curl": "network", "wget": "network", "dig": "network", "nslookup": "network",
		"ping": "network", "openssl": "network", "ssh": "network", "scp": "network",
		"rsync": "network",
		// Database
		"sqlite3": "database", "psql": "database", "mysql": "database",
		"redis-cli": "database", "mongosh": "database",
		// Deploy
		"fly": "deploy", "flyctl": "deploy", "kubectl": "deploy",
		"terraform": "deploy", "helm": "deploy", "vercel": "deploy", "netlify": "deploy",
		// System
		"brew": "system", "which": "system", "env": "system", "kill": "system",
		"killall": "system",
	}

	setID, found := commandToSet[baseCmd]
	if !found {
		return nil, ""
	}

	set, exists := sets[setID]
	if !exists {
		return nil, ""
	}

	return &set, baseCmd
}

// GetAllPermissions returns all permissions for a set at a given risk level and below
// For example, "permissive" returns Common + Permissive permissions
func (s *PermissionSet) GetAllPermissions(upToLevel RiskLevel) []string {
	var perms []string

	perms = append(perms, s.Permissions.Common...)

	if upToLevel == RiskPermissive || upToLevel == RiskYOLO {
		perms = append(perms, s.Permissions.Permissive...)
	}

	if upToLevel == RiskYOLO {
		perms = append(perms, s.Permissions.YOLO...)
	}

	return perms
}

// helper function
func indexOf(s string, sep byte) int {
	for i := 0; i < len(s); i++ {
		if s[i] == sep {
			return i
		}
	}
	return -1
}
