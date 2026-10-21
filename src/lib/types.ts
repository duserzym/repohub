export type CheckState = "SUCCESS" | "FAILURE" | "ERROR" | "PENDING" | "EXPECTED" | null;

export interface Milestone {
  title: string;
  url: string;
  dueOn: string | null;
  progress: number; // 0..100
  open: number;
  closed: number;
}

export interface Repo {
  id: string;
  nameWithOwner: string;
  owner: string;
  ownerAvatar: string;
  name: string;
  description: string;
  url: string;
  homepageUrl: string | null;
  isPrivate: boolean;
  isFork: boolean;
  isArchived: boolean;
  stars: number;
  forks: number;
  pushedAt: string | null;
  createdAt: string;
  language: { name: string; color: string } | null;
  topics: string[];
  openIssues: number;
  closedIssues: number;
  openPRs: number;
  mergedPRs: number;
  milestones: Milestone[];
  latestRelease: { name: string; tag: string; publishedAt: string; url: string } | null;
  defaultBranch: string | null;
  lastCommit: { oid: string; date: string; message: string } | null;
  ci: CheckState;
  /** Commits per week, oldest → newest (8 weeks). */
  weekly: number[];
  /** Candidate icon files found in the repo tree, best first. */
  iconPaths: string[];
  socialImage: string | null;
  /** true when the repo is tracked from search rather than owned/collaborated. */
  tracked?: boolean;
}

export interface Category {
  id: string;
  name: string;
  color: string;
  /** Repos whose name/description/topics contain any keyword are auto-assigned. */
  keywords: string[];
}

export interface TeamMember {
  login: string;
  role: "owner" | "maintainer" | "member" | "viewer";
}

/** Team management — local model now, GitHub org/team sync later. */
export interface Team {
  id: string;
  name: string;
  members: TeamMember[];
  categoryIds: string[];
  repoIds: string[];
}

export type MenuBarStat = "issues" | "prs" | "ci" | "commits" | "progress";

export interface Settings {
  pollMinutes: number;
  includeForks: boolean;
  includeArchived: boolean;
  affiliations: ("OWNER" | "COLLABORATOR" | "ORGANIZATION_MEMBER")[];
  maxRepos: number;
  menuBarStats: MenuBarStat[];
  theme: "system" | "light" | "dark";
  clientId: string;
  sort: "pushed" | "name" | "progress" | "issues" | "stars";
}

export interface Viewer {
  login: string;
  name: string | null;
  avatarUrl: string;
}

export interface SearchResult {
  id: number;
  fullName: string;
  owner: string;
  ownerAvatar: string;
  description: string;
  url: string;
  stars: number;
  forks: number;
  language: string | null;
  topics: string[];
  license: string | null;
  pushedAt: string;
  archived: boolean;
  isTemplate: boolean;
  openIssues: number;
}
