// ============================================================================
// GitHub API Helpers
// ============================================================================

interface ChangedFile {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
}

/**
 * Get changed files from a pull request.
 */
export async function getChangedFiles(
  token: string,
  owner: string,
  repo: string,
  prNumber: number
): Promise<ChangedFile[]> {
  const url = `https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}/files`;
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github.v3+json',
    },
  });

  if (!response.ok) {
    throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
  }

  return (await response.json()) as ChangedFile[];
}

/**
 * Get the diff for a pull request.
 */
export async function getPRDiff(
  token: string,
  owner: string,
  repo: string,
  prNumber: number
): Promise<string> {
  const url = `https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}`;
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github.v3.diff',
    },
  });

  if (!response.ok) {
    throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
  }

  return response.text();
}

/**
 * Post a comment on a pull request.
 */
export async function postComment(
  token: string,
  owner: string,
  repo: string,
  prNumber: number,
  body: string
): Promise<void> {
  const url = `https://api.github.com/repos/${owner}/${repo}/issues/${prNumber}/comments`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ body }),
  });

  if (!response.ok) {
    throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
  }
}

interface CommitFile {
  path: string;
  content: string;
}

/**
 * Create a commit with the given files on a branch.
 */
export async function createCommit(
  token: string,
  owner: string,
  repo: string,
  branch: string,
  files: CommitFile[]
): Promise<void> {
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github.v3+json',
    'Content-Type': 'application/json',
  };

  // Get the current branch ref
  const refResponse = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/git/ref/heads/${branch}`,
    { headers }
  );
  if (!refResponse.ok) {
    throw new Error(`Failed to get branch ref: ${refResponse.status}`);
  }
  const refData = (await refResponse.json()) as { object: { sha: string } };
  const baseSha = refData.object.sha;

  // Get the base tree
  const commitResponse = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/git/commits/${baseSha}`,
    { headers }
  );
  if (!commitResponse.ok) {
    throw new Error(`Failed to get commit: ${commitResponse.status}`);
  }
  const commitData = (await commitResponse.json()) as { tree: { sha: string } };
  const baseTreeSha = commitData.tree.sha;

  // Create blobs for each file
  const tree = await Promise.all(
    files.map(async (file) => {
      const blobResponse = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/blobs`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ content: file.content, encoding: 'utf-8' }),
      });
      if (!blobResponse.ok) {
        throw new Error(`Failed to create blob: ${blobResponse.status}`);
      }
      const blobData = (await blobResponse.json()) as { sha: string };
      return {
        path: file.path,
        mode: '100644' as const,
        type: 'blob' as const,
        sha: blobData.sha,
      };
    })
  );

  // Create tree
  const treeResponse = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/trees`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ base_tree: baseTreeSha, tree }),
  });
  if (!treeResponse.ok) {
    throw new Error(`Failed to create tree: ${treeResponse.status}`);
  }
  const treeData = (await treeResponse.json()) as { sha: string };

  // Create commit
  const newCommitResponse = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/git/commits`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({
        message: 'docs: update documentation (DocSynth)',
        tree: treeData.sha,
        parents: [baseSha],
      }),
    }
  );
  if (!newCommitResponse.ok) {
    throw new Error(`Failed to create commit: ${newCommitResponse.status}`);
  }
  const newCommitData = (await newCommitResponse.json()) as { sha: string };

  // Update branch ref
  const updateRefResponse = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/git/refs/heads/${branch}`,
    {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ sha: newCommitData.sha }),
    }
  );
  if (!updateRefResponse.ok) {
    throw new Error(`Failed to update ref: ${updateRefResponse.status}`);
  }
}
