import * as vscode from 'vscode';

import { PhabNodeProvider } from './phabricode';
export async function activate(context: vscode.ExtensionContext) {

	const myScheme = 'phab';

	// for the "phab:D<number>" virtual document
	const myProvider = new class implements vscode.TextDocumentContentProvider {
		// emitter and its event
		onDidChangeEmitter = new vscode.EventEmitter<vscode.Uri>();
		onDidChange = this.onDidChangeEmitter.event;

		async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
			return await phabNodeProvider.fetchPhabDetails(uri);
		}
	};
	vscode.workspace.registerTextDocumentContentProvider(myScheme, myProvider);

	// wiring up comments
	const commentController = vscode.comments.createCommentController('phab-comments', 'Comment API used to in-line phab comments');
	context.subscriptions.push(commentController);

	const phabNodeProvider = new PhabNodeProvider(commentController);
	await phabNodeProvider.setup();
	vscode.window.registerTreeDataProvider('phabricode', phabNodeProvider);
	vscode.commands.registerCommand('phabricode.refreshEntry', () => phabNodeProvider.refresh());
	vscode.commands.registerCommand('phabricode.loadPhab', phab => phabNodeProvider.loadPhab(phab));
	vscode.commands.registerCommand('phabricode.loadPhabFromUserInput', () => phabNodeProvider.loadPhabFromUserInput());
	vscode.commands.registerCommand('phabricode.openPhab', obj => vscode.commands.executeCommand('vscode.open', vscode.Uri.parse(`${obj.uri}`)));
	vscode.commands.registerCommand('phabricode.gitCheckout', phab => phabNodeProvider.gitCheckout(phab));

	

	// this controls where gutter decorations that allow adding comments are shown
	commentController.commentingRangeProvider = {
		provideCommentingRanges: (document: vscode.TextDocument, token: vscode.CancellationToken) => {
			const lineCount = document.lineCount;
			return [new vscode.Range(0, 0, lineCount - 1, 0)];
		}
	};
}