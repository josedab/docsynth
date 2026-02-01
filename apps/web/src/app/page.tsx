import Link from 'next/link';

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-24">
      <div className="max-w-5xl w-full text-center">
        <h1 className="text-6xl font-bold mb-4">
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-600 to-purple-600">
            DocSynth
          </span>
        </h1>
        <p className="text-xl text-gray-600 dark:text-gray-400 mb-8">
          AI-powered documentation that stays current with your code
        </p>

        <div className="flex gap-4 justify-center mb-16">
          <Link
            href="/auth/login"
            className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            Get Started
          </Link>
          <a
            href="https://github.com/docsynth/docsynth"
            target="_blank"
            rel="noopener noreferrer"
            className="px-6 py-3 border border-gray-300 dark:border-gray-700 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          >
            View on GitHub
          </a>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 text-left">
          <div className="p-6 border border-gray-200 dark:border-gray-800 rounded-lg">
            <h3 className="text-xl font-semibold mb-2">🤖 AI-Powered</h3>
            <p className="text-gray-600 dark:text-gray-400">
              Automatically generates documentation from your code changes, PR descriptions, and
              linked tickets.
            </p>
          </div>

          <div className="p-6 border border-gray-200 dark:border-gray-800 rounded-lg">
            <h3 className="text-xl font-semibold mb-2">🔄 Always Current</h3>
            <p className="text-gray-600 dark:text-gray-400">
              Documentation updates automatically when code changes. No more outdated docs.
            </p>
          </div>

          <div className="p-6 border border-gray-200 dark:border-gray-800 rounded-lg">
            <h3 className="text-xl font-semibold mb-2">✍️ Human Quality</h3>
            <p className="text-gray-600 dark:text-gray-400">
              Generates documentation that reads like it was written by a senior engineer.
            </p>
          </div>
        </div>

        <div className="mt-16 p-8 bg-gray-100 dark:bg-gray-900 rounded-lg">
          <h2 className="text-2xl font-bold mb-4">How It Works</h2>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 text-center">
            <div>
              <div className="text-3xl mb-2">1️⃣</div>
              <p className="text-sm">Merge a PR</p>
            </div>
            <div>
              <div className="text-3xl mb-2">2️⃣</div>
              <p className="text-sm">DocSynth analyzes changes</p>
            </div>
            <div>
              <div className="text-3xl mb-2">3️⃣</div>
              <p className="text-sm">Gathers context from Jira, Slack</p>
            </div>
            <div>
              <div className="text-3xl mb-2">4️⃣</div>
              <p className="text-sm">Creates a docs PR</p>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
