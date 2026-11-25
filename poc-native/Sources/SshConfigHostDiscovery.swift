import Foundation

/// Discovers concrete Host aliases from ~/.ssh/config and recursively included files.
/// Authentication and connection options remain owned by OpenSSH itself; the selected
/// alias is passed unchanged to /usr/bin/ssh so IdentityFile, IdentityAgent, User,
/// HostName, Port, known_hosts, certificates and agent behavior are resolved normally.
public enum SshConfigHostDiscovery {
    private static let maximumFiles = 256
    private static let maximumIncludeDepth = 16
    private static let maximumFileBytes = 1_048_576

    public static func discover() throws -> [String] {
        let home = FileManager.default.homeDirectoryForCurrentUser
        let root = home.appendingPathComponent(".ssh/config")
        var visited = Set<String>()
        var aliases: [String: String] = [:]
        try visit(root, depth: 0, home: home, visited: &visited, aliases: &aliases)
        return aliases.values.sorted {
            $0.localizedCaseInsensitiveCompare($1) == .orderedAscending
        }
    }

    private static func visit(
        _ file: URL,
        depth: Int,
        home: URL,
        visited: inout Set<String>,
        aliases: inout [String: String]
    ) throws {
        guard depth <= maximumIncludeDepth, visited.count < maximumFiles else { return }
        let canonical = file.standardizedFileURL.resolvingSymlinksInPath()
        let key = canonical.path
        guard !visited.contains(key) else { return }
        visited.insert(key)

        let attributes = try? FileManager.default.attributesOfItem(atPath: key)
        guard let size = attributes?[.size] as? NSNumber,
              size.intValue <= maximumFileBytes,
              let contents = try? String(contentsOf: canonical, encoding: .utf8) else { return }

        for line in contents.components(separatedBy: .newlines) {
            let tokens = tokenize(line)
            guard let directive = tokens.first?.lowercased() else { continue }
            let values = Array(tokens.dropFirst())
            if directive == "host" {
                for value in values {
                    guard isConcreteAlias(value) else { continue }
                    aliases[value.lowercased()] = value
                }
            } else if directive == "include" {
                for value in values {
                    var expanded = value
                    if expanded == "~" {
                        expanded = home.path
                    } else if expanded.hasPrefix("~/") {
                        expanded = home.path + String(expanded.dropFirst())
                    }
                    if expanded.contains("$HOME") {
                        expanded = expanded.replacingOccurrences(of: "$HOME", with: home.path)
                    }
                    let includePath = (expanded as NSString).isAbsolutePath
                        ? expanded
                        : canonical.deletingLastPathComponent().appendingPathComponent(expanded).path
                    for match in expandGlob(includePath) {
                        try visit(URL(fileURLWithPath: match), depth: depth + 1, home: home, visited: &visited, aliases: &aliases)
                    }
                }
            }
        }
    }

    private static func isConcreteAlias(_ value: String) -> Bool {
        guard !value.isEmpty, value != "*", value != "!" else { return false }
        return !value.contains("*") && !value.contains("?")
            && !value.contains("[") && !value.contains("]")
            && !value.hasPrefix("!")
    }

    private static func tokenize(_ line: String) -> [String] {
        var result: [String] = []
        var token = ""
        var quote: Character?
        var escaped = false
        var started = false

        for character in line {
            if escaped {
                token.append(character)
                escaped = false
                started = true
            } else if character == "\\" && quote != "'" {
                escaped = true
                started = true
            } else if let activeQuote = quote {
                if character == activeQuote { quote = nil }
                else { token.append(character) }
                started = true
            } else if character == "'" || character == "\"" {
                quote = character
                started = true
            } else if character == "#" {
                break
            } else if character.isWhitespace {
                if started { result.append(token) }
                token = ""
                started = false
            } else {
                token.append(character)
                started = true
            }
        }
        if escaped { token.append("\\") }
        if started { result.append(token) }
        return result
    }

    /// Expand wildcard path segments without invoking a shell.
    private static func expandGlob(_ path: String) -> [String] {
        let isAbsolute = (path as NSString).isAbsolutePath
        let components = (path as NSString).pathComponents.filter { $0 != "/" && $0 != "." }
        var candidates = [isAbsolute ? "/" : FileManager.default.currentDirectoryPath]

        for component in components {
            var next: [String] = []
            let hasWildcard = component.contains("*") || component.contains("?") || component.contains("[")
            for candidate in candidates {
                if !hasWildcard {
                    let value = URL(fileURLWithPath: candidate).appendingPathComponent(component).path
                    if FileManager.default.fileExists(atPath: value) { next.append(value) }
                    continue
                }
                guard let entries = try? FileManager.default.contentsOfDirectory(atPath: candidate) else { continue }
                for entry in entries where wildcard(component, matches: entry) {
                    next.append(URL(fileURLWithPath: candidate).appendingPathComponent(entry).path)
                }
            }
            candidates = next
            if candidates.isEmpty { break }
        }
        return candidates.filter {
            var isDirectory: ObjCBool = false
            return FileManager.default.fileExists(atPath: $0, isDirectory: &isDirectory) && !isDirectory.boolValue
        }
    }

    private static func wildcard(_ pattern: String, matches value: String) -> Bool {
        var expression = "^"
        var escaped = false
        for character in pattern {
            if escaped {
                expression += NSRegularExpression.escapedPattern(for: String(character))
                escaped = false
            } else if character == "*" {
                expression += ".*"
            } else if character == "?" {
                expression += "."
            } else if character == "[" {
                expression += "["
            } else if character == "]" {
                expression += "]"
            } else {
                expression += NSRegularExpression.escapedPattern(for: String(character))
            }
        }
        expression += "$"
        guard let regex = try? NSRegularExpression(pattern: expression, options: [.caseInsensitive]) else { return false }
        let range = NSRange(value.startIndex..<value.endIndex, in: value)
        return regex.firstMatch(in: value, range: range) != nil
    }
}
