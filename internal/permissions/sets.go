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
		"git":            gitSet(),
		"node":           nodeSet(),
		"go":             goSet(),
		"python":         pythonSet(),
		"files":          filesSet(),
		"docker":         dockerSet(),
		"make":           makeSet(),
		"custom":         customSet(),
	}
}

// GetOrderedSetIDs returns set IDs in the display order for the UI
// Fixed order: claude-builtin, files, git first, then alphabetical, custom last
func GetOrderedSetIDs() []string {
	return []string{
		"claude-builtin", "files", "git", // Fixed order first
		"docker", "go", "make", "node", "python", // Alphabetical
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
		Name:        "Git Commands",
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

// nodeSet returns the Node.js/NPM permission set
func nodeSet() PermissionSet {
	return PermissionSet{
		ID:          "node",
		Name:        "Node/NPM",
		Description: "Node.js and package management",
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
			},
			Permissive: []string{
				"Bash(npm install:*)",
				"Bash(npm update:*)",
				"Bash(npm run:*)",
				"Bash(npm test:*)",
				"Bash(npm start:*)",
				"Bash(npm build:*)",
				"Bash(npm ci:*)",
				"Bash(yarn install:*)",
				"Bash(yarn add:*)",
				"Bash(yarn:*)",
				"Bash(pnpm install:*)",
				"Bash(pnpm add:*)",
				"Bash(npx:*)",
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
		Name:        "Go Commands",
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
				"Bash(go generate:*)",
				"Bash(go fmt:*)",
				"Bash(go get:*)",
				"Bash(gofmt -w:*)",
			},
			YOLO: []string{
				"Bash(go install:*)",
				"Bash(go clean:*)",
				"Bash(go run:*)",
			},
		},
	}
}

// pythonSet returns the Python permission set
func pythonSet() PermissionSet {
	return PermissionSet{
		ID:          "python",
		Name:        "Python",
		Description: "Python and pip operations",
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
			},
			YOLO: []string{
				"Bash(pip uninstall:*)",
				"Bash(python:*)",
				"Bash(python3:*)",
			},
		},
	}
}

// filesSet returns the File Utilities permission set
func filesSet() PermissionSet {
	return PermissionSet{
		ID:          "files",
		Name:        "File Utilities",
		Description: "File system operations",
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
		Description: "Build system operations",
		Permissions: PermissionTiers{
			Common: []string{
				"Bash(make --dry-run:*)",
				"Bash(make -n:*)",
				"Bash(make --version:*)",
				"Bash(make help:*)",
			},
			Permissive: []string{
				"Bash(make:*)",
				"Bash(make build:*)",
				"Bash(make test:*)",
				"Bash(make lint:*)",
				"Bash(make check:*)",
				"Bash(make all:*)",
			},
			YOLO: []string{
				"Bash(make clean:*)",
				"Bash(make install:*)",
				"Bash(make deploy:*)",
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
		Description: "Add your own Bash patterns (e.g., wails, cargo, etc.)",
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
		"git":            "git",
		"npm":            "node",
		"yarn":           "node",
		"pnpm":           "node",
		"npx":            "node",
		"node":           "node",
		"go":             "go",
		"gofmt":          "go",
		"python":         "python",
		"python3":        "python",
		"pip":            "python",
		"pip3":           "python",
		"poetry":         "python",
		"pytest":         "python",
		"ls":             "files",
		"cat":            "files",
		"head":           "files",
		"tail":           "files",
		"cp":             "files",
		"mv":             "files",
		"rm":             "files",
		"mkdir":          "files",
		"find":           "files",
		"grep":           "files",
		"tree":           "files",
		"docker":         "docker",
		"docker-compose": "docker",
		"make":           "make",
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
