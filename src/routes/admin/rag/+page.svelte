<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';

	let activeTab = $state<'documents' | 'query' | 'graph'>('documents');
	let lightragStatus = $state<'checking' | 'healthy' | 'unhealthy'>('checking');
	let statusMessage = $state<string>('');

	// Documents tab state
	let documents = $state<any[]>([]);
	let uploadFiles = $state<FileList | null>(null);
	let uploading = $state(false);
	let uploadMessage = $state('');
	let uploadProgress = $state<string>('');

	// Query tab state
	let queryText = $state('');
	let queryMode = $state<'naive' | 'local' | 'global' | 'hybrid'>('hybrid');
	let queryResult = $state<any>(null);
	let querying = $state(false);

	// Graph tab state
	let graphStats = $state<any>(null);
	let loadingStats = $state(false);
	let searchQuery = $state('');
	let searchResults = $state<any[]>([]);
	let searching = $state(false);
	let topNodesMetric = $state<'degree' | 'betweenness' | 'pagerank'>('degree');
	let topNodes = $state<any[]>([]);
	let loadingTopNodes = $state(false);

	// Interactive visualization state
	let maxNodes = $state(100);
	let minDegree = $state(1);
	let generatingGraph = $state(false);
	let graphGenerated = $state(false);
	let graphUrl = $state('');

	onMount(async () => {
		// Check if user is admin
		const session = $page.data.session;
		if (!session || !session.user?.isAdmin) {
			goto('/');
			return;
		}

		// Check LightRAG health
		await checkHealth();

		// Load initial data
		if (lightragStatus === 'healthy') {
			await loadDocuments();
		}
	});

	async function checkHealth() {
		try {
			const response = await fetch('/api/rag/health');
			const data = await response.json();

			if (data.status === 'healthy') {
				lightragStatus = 'healthy';
				statusMessage = '';
			} else {
				lightragStatus = 'unhealthy';
				statusMessage = data.error || 'LightRAG is not available';
			}
		} catch (error) {
			lightragStatus = 'unhealthy';
			statusMessage = 'Failed to connect to LightRAG';
		}
	}

	async function loadDocuments() {
		try {
			const response = await fetch('/api/rag/documents/list');
			if (!response.ok) throw new Error('Failed to load documents');

			const data = await response.json();
			documents = data.documents || [];
		} catch (error) {
			console.error('Failed to load documents:', error);
		}
	}

	async function clearProcessingDocuments() {
		if (!confirm('Clear all processing documents? This will remove unprocessed PDF files and stop any ongoing processing.')) {
			return;
		}

		try {
			const response = await fetch('/api/rag/documents/clear-processing', {
				method: 'POST',
			});

			if (!response.ok) {
				const errorData = await response.json();
				throw new Error(errorData.error || 'Failed to clear processing documents');
			}

			const data = await response.json();
			alert(`Cleared ${data.removed || 0} processing document(s)`);

			// Reload documents list
			await loadDocuments();
		} catch (error: any) {
			alert(`Error: ${error.message}`);
			console.error('Failed to clear processing documents:', error);
		}
	}

	async function handleUpload() {
		if (!uploadFiles || uploadFiles.length === 0) {
			uploadMessage = 'Please select at least one file';
			return;
		}

		uploading = true;
		uploadMessage = '';
		uploadProgress = `Uploading ${uploadFiles.length} file(s)...`;

		try {
			const formData = new FormData();

			// Upload files one by one for better progress tracking
			for (let i = 0; i < uploadFiles.length; i++) {
				const file = uploadFiles[i];
				uploadProgress = `Processing file ${i + 1} of ${uploadFiles.length}: ${file.name}`;

				const singleFormData = new FormData();
				singleFormData.append('files', file);

				const response = await fetch('/api/rag/documents/upload', {
					method: 'POST',
					body: singleFormData,
				});

				if (!response.ok) {
					const errorData = await response.json();
					console.error(`Failed to upload ${file.name}:`, errorData);
				}
			}

			uploadMessage = `Successfully uploaded ${uploadFiles.length} file(s). Processing in background...`;
			uploadProgress = '';

			// Reload documents after a short delay to show uploaded files
			setTimeout(() => loadDocuments(), 2000);

			// Clear file input
			uploadFiles = null;
		} catch (error: any) {
			uploadMessage = `Error: ${error.message}`;
			uploadProgress = '';
		} finally {
			uploading = false;
		}
	}

	async function handleQuery() {
		if (!queryText.trim()) {
			return;
		}

		querying = true;
		queryResult = null;

		try {
			const response = await fetch('/api/rag/query', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					query: queryText,
					mode: queryMode,
					top_k: 5,
					return_sources: true,
					use_cache: true,
				}),
			});

			if (!response.ok) {
				const errorData = await response.json();
				throw new Error(errorData.error || 'Query failed');
			}

			queryResult = await response.json();
		} catch (error: any) {
			queryResult = { error: error.message };
		} finally {
			querying = false;
		}
	}

	async function loadGraphStats() {
		loadingStats = true;
		try {
			const response = await fetch('/api/rag/graph/stats');
			if (!response.ok) throw new Error('Failed to load graph stats');

			const data = await response.json();
			graphStats = data.stats;
		} catch (error) {
			console.error('Failed to load graph stats:', error);
		} finally {
			loadingStats = false;
		}
	}

	async function searchNodes() {
		if (!searchQuery.trim()) return;

		searching = true;
		try {
			const response = await fetch(`/api/rag/graph/search?query=${encodeURIComponent(searchQuery)}&limit=10`);
			if (!response.ok) throw new Error('Search failed');

			const data = await response.json();
			searchResults = data.results || [];
		} catch (error) {
			console.error('Search failed:', error);
			searchResults = [];
		} finally {
			searching = false;
		}
	}

	async function loadTopNodes() {
		loadingTopNodes = true;
		try {
			const response = await fetch(`/api/rag/graph/top-nodes?top_k=10&metric=${topNodesMetric}`);
			if (!response.ok) throw new Error('Failed to load top nodes');

			const data = await response.json();
			topNodes = data.nodes || [];
		} catch (error) {
			console.error('Failed to load top nodes:', error);
			topNodes = [];
		} finally {
			loadingTopNodes = false;
		}
	}

	async function generateInteractiveGraph() {
		generatingGraph = true;
		try {
			const response = await fetch(`/api/rag/graph/interactive?max_nodes=${maxNodes}&min_degree=${minDegree}`);
			if (!response.ok) throw new Error('Failed to generate graph');

			const data = await response.json();
			if (data.success) {
				graphGenerated = true;
				graphUrl = data.view_url;
			}
		} catch (error) {
			console.error('Failed to generate graph:', error);
			alert('Failed to generate interactive graph');
		} finally {
			generatingGraph = false;
		}
	}

	function switchTab(tab: 'documents' | 'query' | 'graph') {
		activeTab = tab;

		// Load tab-specific data
		if (tab === 'documents') {
			loadDocuments();
		} else if (tab === 'graph') {
			loadGraphStats();
			loadTopNodes();
		}
	}
</script>

<div class="min-h-screen bg-background">
	<div class="container mx-auto px-4 py-8">
		<div class="mb-6">
			<h1 class="text-3xl font-bold mb-2">RAG Knowledge Base Management</h1>
			<p class="text-muted-foreground">Manage documents, execute queries, and explore the knowledge graph</p>
		</div>

		<!-- LightRAG Status -->
		<div class="mb-6 p-4 border rounded-lg bg-card">
			<div class="flex items-center gap-2">
				<div class="w-3 h-3 rounded-full {lightragStatus === 'healthy' ? 'bg-green-500' : lightragStatus === 'checking' ? 'bg-yellow-500 animate-pulse' : 'bg-red-500'}"></div>
				<span class="font-medium">
					{#if lightragStatus === 'checking'}
						Checking...
					{:else if lightragStatus === 'healthy'}
						LightRAG is running
					{:else}
						LightRAG unavailable
					{/if}
				</span>
				{#if statusMessage}
					<span class="text-sm text-muted-foreground ml-2">{statusMessage}</span>
				{/if}
			</div>
		</div>

		<!-- Tabs -->
		<div class="border-b mb-6">
			<nav class="flex gap-4">
				<button
					onclick={() => switchTab('documents')}
					class="px-4 py-2 border-b-2 {activeTab === 'documents' ? 'border-primary text-primary font-medium' : 'border-transparent text-muted-foreground hover:text-foreground'}"
				>
					Documents
				</button>
				<button
					onclick={() => switchTab('query')}
					class="px-4 py-2 border-b-2 {activeTab === 'query' ? 'border-primary text-primary font-medium' : 'border-transparent text-muted-foreground hover:text-foreground'}"
				>
					Query
				</button>
				<button
					onclick={() => switchTab('graph')}
					class="px-4 py-2 border-b-2 {activeTab === 'graph' ? 'border-primary text-primary font-medium' : 'border-transparent text-muted-foreground hover:text-foreground'}"
				>
					Knowledge Graph
				</button>
			</nav>
		</div>

		<!-- Tab Content -->
		{#if lightragStatus !== 'healthy'}
			<div class="p-8 text-center border rounded-lg bg-muted/50">
				<p class="text-lg text-muted-foreground">Please ensure LightRAG service is running</p>
				<button onclick={checkHealth} class="mt-4 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90">
					Check Again
				</button>
			</div>
		{:else if activeTab === 'documents'}
			<!-- Documents Tab -->
			<div class="space-y-6">
				<!-- Upload Section -->
				<div class="border rounded-lg p-6 bg-card">
					<h2 class="text-xl font-semibold mb-4">Upload Documents</h2>
					<div class="space-y-4">
						<div>
							<input
								type="file"
								multiple
								accept=".pdf"
								bind:files={uploadFiles}
								class="block w-full text-sm text-muted-foreground file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-primary file:text-primary-foreground hover:file:bg-primary/90"
							/>
							<p class="text-xs text-muted-foreground mt-2">Supports PDF files. Files will be processed in the background after upload.</p>
						</div>
						<button
							onclick={handleUpload}
							disabled={uploading || !uploadFiles}
							class="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
						>
							{uploading ? 'Uploading...' : 'Upload'}
						</button>
						{#if uploadProgress}
							<p class="text-sm text-blue-600">{uploadProgress}</p>
						{/if}
						{#if uploadMessage}
							<p class="text-sm {uploadMessage.includes('Error') ? 'text-red-500' : 'text-green-500'}">{uploadMessage}</p>
						{/if}
					</div>
				</div>

				<!-- Documents List -->
				<div class="border rounded-lg p-6 bg-card">
					<div class="flex justify-between items-center mb-4">
						<h2 class="text-xl font-semibold">Uploaded Documents ({documents.length})</h2>
						<div class="flex gap-2">
							<button
								onclick={clearProcessingDocuments}
								class="text-sm px-3 py-1 border rounded hover:bg-muted"
							>
								Clear Processing
							</button>
							<button
								onclick={loadDocuments}
								class="text-sm px-3 py-1 border rounded hover:bg-muted"
							>
								Refresh
							</button>
						</div>
					</div>
					{#if documents.length === 0}
						<p class="text-muted-foreground">No documents uploaded yet</p>
					{:else}
						<div class="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
							<p class="text-sm text-blue-800">
								<strong>Note:</strong> Documents are processed in the background by LightRAG.
								This may take several minutes depending on file size and system load.
								{#if documents.some(d => !d.ingested)}
									Currently {documents.filter(d => !d.ingested).length} document(s) are being processed.
								{/if}
							</p>
						</div>
						<div class="space-y-2">
							{#each documents as doc}
								<div class="p-3 border rounded-lg hover:bg-muted/50 flex justify-between items-center">
									<div class="flex-1">
										<p class="font-medium">{doc.file_name}</p>
										<p class="text-xs text-muted-foreground">
											Size: {(doc.file_size / 1024).toFixed(2)} KB | Uploaded: {new Date(doc.uploaded_at).toLocaleString()}
										</p>
									</div>
									<div class="flex items-center gap-2">
										{#if doc.ingested}
											<span class="text-xs px-2 py-1 bg-green-100 text-green-700 rounded font-medium">✓ Processed</span>
										{:else}
											<span class="text-xs px-2 py-1 bg-yellow-100 text-yellow-700 rounded font-medium animate-pulse">⏳ Processing...</span>
										{/if}
									</div>
								</div>
							{/each}
						</div>
					{/if}
				</div>
			</div>
		{:else if activeTab === 'query'}
			<!-- Query Tab -->
			<div class="space-y-6">
				<div class="border rounded-lg p-6 bg-card">
					<h2 class="text-xl font-semibold mb-4">Execute RAG Query</h2>
					<div class="space-y-4">
						<div>
							<label class="block text-sm font-medium mb-2">Query Mode</label>
							<select bind:value={queryMode} class="w-full px-3 py-2 border rounded-lg bg-background">
								<option value="naive">Naive (Vector only)</option>
								<option value="local">Local (Entity-based)</option>
								<option value="global">Global (Graph structure)</option>
								<option value="hybrid">Hybrid (Recommended)</option>
							</select>
							<p class="text-xs text-muted-foreground mt-1">
								{#if queryMode === 'naive'}
									Pure vector similarity search
								{:else if queryMode === 'local'}
									Entity-focused local search
								{:else if queryMode === 'global'}
									Graph structure-based global search
								{:else}
									Combines all search modes for best results
								{/if}
							</p>
						</div>
						<div>
							<label class="block text-sm font-medium mb-2">Query</label>
							<textarea
								bind:value={queryText}
								placeholder="Enter your question..."
								rows="4"
								class="w-full px-3 py-2 border rounded-lg bg-background"
							></textarea>
						</div>
						<button
							onclick={handleQuery}
							disabled={querying || !queryText.trim()}
							class="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
						>
							{querying ? 'Querying...' : 'Execute Query'}
						</button>
					</div>
				</div>

				{#if queryResult}
					<div class="border rounded-lg p-6 bg-card">
						<h2 class="text-xl font-semibold mb-4">Query Result</h2>
						{#if queryResult.error}
							<p class="text-red-500">{queryResult.error}</p>
						{:else}
							<div class="space-y-4">
								<div>
									<h3 class="font-medium mb-2">Answer:</h3>
									<p class="whitespace-pre-wrap">{queryResult.answer}</p>
								</div>
								{#if queryResult.sources && queryResult.sources.length > 0}
									<div>
										<h3 class="font-medium mb-2">Sources:</h3>
										<div class="space-y-2">
											{#each queryResult.sources as source}
												<div class="p-2 border rounded bg-muted/50">
													<p class="text-sm">{source}</p>
												</div>
											{/each}
										</div>
									</div>
								{/if}
							</div>
						{/if}
					</div>
				{/if}
			</div>
		{:else if activeTab === 'graph'}
			<!-- Graph Tab -->
			<div class="space-y-6">
				<!-- Graph Stats -->
				<div class="border rounded-lg p-6 bg-card">
					<div class="flex justify-between items-center mb-4">
						<h2 class="text-xl font-semibold">Graph Statistics</h2>
						<button onclick={loadGraphStats} disabled={loadingStats} class="text-sm px-3 py-1 border rounded hover:bg-muted">
							{loadingStats ? 'Loading...' : 'Refresh'}
						</button>
					</div>
					{#if graphStats}
						<div class="grid grid-cols-3 gap-4">
							<div class="p-4 border rounded">
								<p class="text-sm text-muted-foreground">Nodes</p>
								<p class="text-2xl font-bold">{graphStats.num_nodes || graphStats['總節點數'] || 0}</p>
							</div>
							<div class="p-4 border rounded">
								<p class="text-sm text-muted-foreground">Edges</p>
								<p class="text-2xl font-bold">{graphStats.num_edges || graphStats['總邊數'] || 0}</p>
							</div>
							<div class="p-4 border rounded">
								<p class="text-sm text-muted-foreground">Avg Degree</p>
								<p class="text-2xl font-bold">{(graphStats.avg_degree || graphStats['平均度數'])?.toFixed(2) || 0}</p>
							</div>
						</div>
					{:else if !loadingStats}
						<p class="text-muted-foreground">Click refresh to view statistics</p>
					{/if}
				</div>

				<!-- Search Nodes -->
				<div class="border rounded-lg p-6 bg-card">
					<h2 class="text-xl font-semibold mb-4">Search Nodes</h2>
					<div class="flex gap-2 mb-4">
						<input
							type="text"
							bind:value={searchQuery}
							placeholder="Enter search keywords..."
							class="flex-1 px-3 py-2 border rounded-lg bg-background"
							onkeydown={(e) => e.key === 'Enter' && searchNodes()}
						/>
						<button onclick={searchNodes} disabled={searching} class="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50">
							{searching ? 'Searching...' : 'Search'}
						</button>
					</div>
					{#if searchResults.length > 0}
						<div class="space-y-2">
							{#each searchResults as result}
								<div class="p-3 border rounded-lg hover:bg-muted/50">
									<p class="font-medium">{result.node}</p>
									{#if result.description}
										<p class="text-sm text-muted-foreground">{result.description}</p>
									{/if}
								</div>
							{/each}
						</div>
					{:else if searchQuery && !searching}
						<p class="text-muted-foreground">No nodes found</p>
					{/if}
				</div>

				<!-- Top Nodes -->
				<div class="border rounded-lg p-6 bg-card">
					<div class="flex justify-between items-center mb-4">
						<h2 class="text-xl font-semibold">Top Nodes</h2>
						<div class="flex gap-2">
							<select bind:value={topNodesMetric} onchange={loadTopNodes} class="px-3 py-1 border rounded-lg bg-background text-sm">
								<option value="degree">Degree</option>
								<option value="betweenness">Betweenness</option>
								<option value="pagerank">PageRank</option>
							</select>
							<button onclick={loadTopNodes} disabled={loadingTopNodes} class="text-sm px-3 py-1 border rounded hover:bg-muted">
								{loadingTopNodes ? 'Loading...' : 'Refresh'}
							</button>
						</div>
					</div>
					{#if topNodes.length > 0}
						<div class="space-y-2">
							{#each topNodes as node, index}
								<div class="p-3 border rounded-lg hover:bg-muted/50 flex justify-between items-center">
									<div>
										<span class="text-sm text-muted-foreground mr-2">#{index + 1}</span>
										<span class="font-medium">{node.node}</span>
									</div>
									<span class="text-sm text-muted-foreground">{node.score.toFixed(4)}</span>
								</div>
							{/each}
						</div>
					{:else if !loadingTopNodes}
						<p class="text-muted-foreground">Click refresh to view top nodes</p>
					{/if}
				</div>

				<!-- Interactive Visualization -->
				<div class="border rounded-lg p-6 bg-card">
					<h2 class="text-xl font-semibold mb-4">Interactive Knowledge Graph Visualization</h2>
					<div class="space-y-4">
						<div class="grid grid-cols-2 gap-4">
							<div>
								<label class="block text-sm font-medium mb-2">Max Nodes</label>
								<input
									type="number"
									bind:value={maxNodes}
									min="10"
									max="500"
									class="w-full px-3 py-2 border rounded-lg bg-background"
								/>
								<p class="text-xs text-muted-foreground mt-1">Number of nodes to display (10-500)</p>
							</div>
							<div>
								<label class="block text-sm font-medium mb-2">Min Degree</label>
								<input
									type="number"
									bind:value={minDegree}
									min="0"
									max="10"
									class="w-full px-3 py-2 border rounded-lg bg-background"
								/>
								<p class="text-xs text-muted-foreground mt-1">Filter nodes by minimum connections</p>
							</div>
						</div>
						<button
							onclick={generateInteractiveGraph}
							disabled={generatingGraph}
							class="w-full px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
						>
							{generatingGraph ? 'Generating...' : 'Generate Interactive Visualization'}
						</button>
						{#if graphGenerated}
							<div class="border rounded-lg overflow-hidden">
								<iframe
									src="/api/rag{graphUrl}"
									title="Interactive Knowledge Graph"
									class="w-full h-[600px]"
									sandbox="allow-scripts allow-same-origin"
								></iframe>
							</div>
							<p class="text-sm text-muted-foreground text-center">
								💡 Zoom with mouse wheel, drag to pan, click and drag nodes to explore the knowledge graph
							</p>
						{/if}
					</div>
				</div>
			</div>
		{/if}
	</div>
</div>
