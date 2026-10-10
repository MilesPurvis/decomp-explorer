// Export instructions, raw p-code, basic blocks and decompiled C (before and after
// analyst annotation) for the functions listed in a manifest, as JSON.
//
// Args: <manifest.json> <outDir>
//@category Export
import java.io.FileReader;
import java.io.FileWriter;
import java.util.*;

import com.google.gson.*;

import ghidra.app.cmd.function.ApplyFunctionSignatureCmd;
import ghidra.app.cmd.function.FunctionRenameOption;
import ghidra.app.decompiler.*;
import ghidra.app.decompiler.component.DecompilerUtils;
import ghidra.app.script.GhidraScript;
import ghidra.app.util.cparser.C.CParser;
import ghidra.framework.Application;
import ghidra.program.model.address.Address;
import ghidra.program.model.block.*;
import ghidra.program.model.data.*;
import ghidra.program.model.lang.Register;
import ghidra.program.model.listing.*;
import ghidra.program.model.pcode.*;
import ghidra.program.model.symbol.*;

public class ExportDecomp extends GhidraScript {

	private static final String[] SYNTAX = { "keyword", "comment", "type", "function",
		"variable", "const", "parameter", "global", "default", "error", "special" };

	private DecompInterface ifc;

	@Override
	public void run() throws Exception {
		String[] args = getScriptArgs();
		JsonObject manifest;
		try (FileReader r = new FileReader(args[0])) {
			manifest = JsonParser.parseReader(r).getAsJsonObject();
		}
		String variant = currentProgram.getName();
		JsonObject fnAddrs =
			manifest.getAsJsonObject("variants").getAsJsonObject(variant).getAsJsonObject(
				"functions");
		JsonObject annotations = manifest.getAsJsonObject("annotations");

		ifc = new DecompInterface();
		DecompileOptions opts = new DecompileOptions();
		opts.grabFromProgram(currentProgram);
		ifc.setOptions(opts);
		ifc.toggleCCode(true);
		ifc.toggleSyntaxTree(true);
		ifc.setSimplificationStyle("decompile");
		ifc.openProgram(currentProgram);

		JsonObject out = new JsonObject();
		out.addProperty("variant", variant);
		out.addProperty("languageId", currentProgram.getLanguageID().toString());
		out.addProperty("compilerSpec",
			currentProgram.getCompilerSpec().getCompilerSpecID().toString());
		out.addProperty("ghidraVersion", Application.getApplicationVersion());
		JsonObject funcsOut = new JsonObject();
		out.add("functions", funcsOut);

		int tx = currentProgram.startTransaction("ExportDecomp");
		try {
			// Capture every function's raw output before annotating any of them, so one
			// function's types or names can't leak into another's "before" view.
			Map<String, Function> funcs = new LinkedHashMap<>();
			for (String name : fnAddrs.keySet()) {
				Address entry = toAddr(fnAddrs.get(name).getAsString());
				Function f = getFunctionAt(entry);
				if (f == null) {
					f = createFunction(entry, null);
				}
				funcs.put(name, f);

				JsonObject fo = new JsonObject();
				fo.addProperty("ghidraName", f.getName());
				fo.addProperty("entry", entry.toString());
				fo.add("instructions", exportInstructions(f));
				fo.add("blocks", exportBlocks(f));
				fo.add("raw", exportDecomp(f));
				funcsOut.add(name, fo);
			}

			for (Map.Entry<String, Function> e : funcs.entrySet()) {
				String name = e.getKey();
				JsonObject ann = annotations.has(name) ? annotations.getAsJsonObject(name)
						: new JsonObject();
				JsonArray steps = annotate(e.getValue(), name, ann, variant);
				JsonObject fo = funcsOut.getAsJsonObject(name);
				fo.add("annotated", exportDecomp(e.getValue()));
				fo.add("analystSteps", steps);
			}
		}
		finally {
			currentProgram.endTransaction(tx, true);
			ifc.dispose();
		}

		try (FileWriter w = new FileWriter(args[1] + "/" + variant + ".json")) {
			new GsonBuilder().setPrettyPrinting().create().toJson(out, w);
		}
		println("Exported " + funcsOut.size() + " functions from " + variant);
	}

	private JsonArray exportInstructions(Function f) {
		JsonArray arr = new JsonArray();
		Listing listing = currentProgram.getListing();
		for (Instruction ins : listing.getInstructions(f.getBody(), true)) {
			JsonObject o = new JsonObject();
			o.addProperty("addr", ins.getAddress().toString());
			try {
				o.addProperty("bytes", hex(ins.getBytes()));
			}
			catch (Exception ex) {
				o.addProperty("bytes", "");
			}
			o.addProperty("mnemonic", ins.getMnemonicString());
			o.addProperty("text", CodeUnitFormat.DEFAULT.getRepresentationString(ins));
			o.addProperty("flow", ins.getFlowType().toString());
			JsonArray pc = new JsonArray();
			for (PcodeOp op : ins.getPcode()) {
				pc.add(formatOp(op));
			}
			o.add("pcode", pc);
			arr.add(o);
		}
		return arr;
	}

	private JsonArray exportBlocks(Function f) throws Exception {
		JsonArray arr = new JsonArray();
		BasicBlockModel model = new BasicBlockModel(currentProgram);
		CodeBlockIterator it = model.getCodeBlocksContaining(f.getBody(), monitor);
		while (it.hasNext()) {
			CodeBlock b = it.next();
			JsonObject o = new JsonObject();
			o.addProperty("start", b.getFirstStartAddress().toString());
			o.addProperty("end", b.getMaxAddress().toString());
			JsonArray edges = new JsonArray();
			CodeBlockReferenceIterator dests = b.getDestinations(monitor);
			while (dests.hasNext()) {
				CodeBlockReference ref = dests.next();
				Address dst = ref.getDestinationAddress();
				if (!f.getBody().contains(dst)) {
					continue;
				}
				FlowType ft = ref.getFlowType();
				JsonObject e = new JsonObject();
				e.addProperty("to", dst.toString());
				e.addProperty("kind", ft.isFallthrough() ? "fallthrough"
						: ft.isConditional() ? "conditional" : ft.isComputed() ? "computed"
								: "jump");
				edges.add(e);
			}
			o.add("edges", edges);
			arr.add(o);
		}
		return arr;
	}

	private JsonObject exportDecomp(Function f) {
		DecompileResults res = ifc.decompileFunction(f, 120, monitor);
		JsonObject o = new JsonObject();
		if (!res.decompileCompleted()) {
			o.addProperty("error", res.getErrorMessage());
			return o;
		}
		o.addProperty("signature", f.getPrototypeString(false, false));
		JsonArray lines = new JsonArray();
		for (ClangLine line : DecompilerUtils.toLines(res.getCCodeMarkup())) {
			JsonObject lo = new JsonObject();
			lo.addProperty("indent", line.getIndent());
			JsonArray toks = new JsonArray();
			for (ClangToken t : line.getAllTokens()) {
				if (t.getText().isEmpty()) {
					continue;
				}
				JsonObject to = new JsonObject();
				to.addProperty("t", t.getText());
				int st = t.getSyntaxType();
				to.addProperty("k", st >= 0 && st < SYNTAX.length ? SYNTAX[st] : "default");
				JsonArray addrs = new JsonArray();
				Set<String> seen = new LinkedHashSet<>();
				addAddr(seen, t.getMinAddress());
				addAddr(seen, t.getMaxAddress());
				PcodeOp op = t.getPcodeOp();
				if (op != null) {
					addAddr(seen, op.getSeqnum().getTarget());
				}
				// Keywords and punctuation carry no op of their own; borrow the enclosing
				// statement's so hovering `while` or `return` still points at real code.
				if (seen.isEmpty()) {
					ClangStatement stmt = enclosingStatement(t);
					if (stmt != null && stmt.getPcodeOp() != null) {
						addAddr(seen, stmt.getPcodeOp().getSeqnum().getTarget());
					}
				}
				for (String s : seen) {
					addrs.add(s);
				}
				if (addrs.size() > 0) {
					to.add("a", addrs);
				}
				toks.add(to);
			}
			lo.add("tokens", toks);
			lines.add(lo);
		}
		o.add("lines", lines);
		return o;
	}

	private JsonArray annotate(Function f, String name, JsonObject ann, String variant)
			throws Exception {
		JsonArray steps = new JsonArray();
		DataTypeManager dtm = currentProgram.getDataTypeManager();
		String oldName = f.getName();

		String types = ann.has("types") ? ann.get("types").getAsString() : "";
		String proto = ann.has("prototype") ? ann.get("prototype").getAsString() : null;
		if (proto != null) {
			CParser parser = new CParser(dtm, true, null);
			parser.parse(types + "\n" + proto);
			for (DataType dt : parser.getComposites().values()) {
				steps.add("Defined " + dt.getDisplayName() + " (" + dt.getLength() +
					" bytes) from the field offsets the code uses");
			}
			DataType def = parser.getFunctions().get(name);
			if (def == null) {
				throw new IllegalStateException("Prototype for " + name + " did not parse");
			}
			ApplyFunctionSignatureCmd cmd = new ApplyFunctionSignatureCmd(f.getEntryPoint(),
				(FunctionSignature) def, SourceType.USER_DEFINED, true,
				FunctionRenameOption.RENAME);
			if (!cmd.applyTo(currentProgram)) {
				throw new IllegalStateException(cmd.getStatusMsg());
			}
			// Parsed prototypes carry no convention; without this the decompiler warns
			// "Unknown calling convention" on every annotated function.
			f.setCallingConvention(Function.DEFAULT_CALLING_CONVENTION_STRING);
			steps.add("Renamed " + oldName + " → " + name);
			steps.add("Applied signature: " + proto.replaceAll(";\\s*$", ""));
		}

		Map<String, String> renames = new LinkedHashMap<>();
		collectRenames(renames, ann.getAsJsonObject("renames"));
		if (ann.has("renamesByVariant")) {
			collectRenames(renames,
				ann.getAsJsonObject("renamesByVariant").getAsJsonObject(variant));
		}
		if (!renames.isEmpty()) {
			DecompileResults res = ifc.decompileFunction(f, 120, monitor);
			HighFunction hf = res.getHighFunction();
			if (hf != null) {
				Iterator<HighSymbol> syms = hf.getLocalSymbolMap().getSymbols();
				List<HighSymbol> toRename = new ArrayList<>();
				while (syms.hasNext()) {
					HighSymbol s = syms.next();
					if (renames.containsKey(s.getName())) {
						toRename.add(s);
					}
				}
				for (HighSymbol s : toRename) {
					String from = s.getName();
					HighFunctionDBUtil.updateDBVariable(s, renames.get(from), null,
						SourceType.USER_DEFINED);
					steps.add("Renamed local " + from + " → " + renames.get(from));
				}
			}
		}
		return steps;
	}

	private static void collectRenames(Map<String, String> into, JsonObject src) {
		if (src == null) {
			return;
		}
		for (String k : src.keySet()) {
			into.put(k, src.get(k).getAsString());
		}
	}

	private static ClangStatement enclosingStatement(ClangNode n) {
		for (ClangNode p = n.Parent(); p != null; p = p.Parent()) {
			if (p instanceof ClangStatement) {
				return (ClangStatement) p;
			}
		}
		return null;
	}

	private static void addAddr(Set<String> seen, Address a) {
		if (a != null && a.isMemoryAddress()) {
			seen.add(a.toString());
		}
	}

	private String formatOp(PcodeOp op) {
		StringBuilder sb = new StringBuilder();
		if (op.getOutput() != null) {
			sb.append(formatVn(op.getOutput())).append(" = ");
		}
		sb.append(op.getMnemonic());
		int first = 0;
		// LOAD/STORE's first input is just the address-space id; fold it into the operand.
		if (op.getOpcode() == PcodeOp.LOAD || op.getOpcode() == PcodeOp.STORE) {
			first = 1;
		}
		for (int i = first; i < op.getNumInputs(); i++) {
			sb.append(i == first ? " " : ", ");
			Varnode in = op.getInput(i);
			if (first == 1 && i == 1) {
				sb.append("[").append(formatVn(in)).append("]");
			}
			else {
				sb.append(formatVn(in));
			}
		}
		return sb.toString();
	}

	private String formatVn(Varnode v) {
		if (v == null) {
			return "_";
		}
		if (v.isRegister()) {
			Register r = currentProgram.getRegister(v.getAddress(), v.getSize());
			return r != null ? r.getName() : "reg:" + v.getAddress().getOffset();
		}
		if (v.isConstant()) {
			return "0x" + Long.toHexString(v.getOffset());
		}
		if (v.isUnique()) {
			return "$U" + Long.toHexString(v.getOffset());
		}
		if (v.isAddress()) {
			Symbol s = currentProgram.getSymbolTable().getPrimarySymbol(v.getAddress());
			return s != null ? s.getName() : v.getAddress().toString();
		}
		return v.toString();
	}

	private static String hex(byte[] bytes) {
		StringBuilder sb = new StringBuilder();
		for (byte b : bytes) {
			if (sb.length() > 0) {
				sb.append(' ');
			}
			sb.append(String.format("%02x", b & 0xff));
		}
		return sb.toString();
	}
}
