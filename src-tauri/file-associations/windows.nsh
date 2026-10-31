; Register choices without changing the user's default applications.
!macro NSIS_HOOK_POSTINSTALL
  WriteRegStr SHCTX "Software\Classes\PlasmidCraft.project" "" "PlasmidCraft Document"
  WriteRegStr SHCTX "Software\Classes\PlasmidCraft.project\DefaultIcon" "" '$\"$INSTDIR\document.ico$\",0'
  WriteRegStr SHCTX "Software\Classes\PlasmidCraft.project\shell\open\command" "" '$\"$INSTDIR\${MAINBINARYNAME}.exe$\" $\"%1$\"'
  WriteRegStr SHCTX "Software\Classes\.pcraft\OpenWithProgids" "PlasmidCraft.project" ""
  WriteRegStr SHCTX "Software\Classes\PlasmidCraft.protein" "" "PlasmidCraft Protein"
  WriteRegStr SHCTX "Software\Classes\PlasmidCraft.protein\DefaultIcon" "" '$\"$INSTDIR\document.ico$\",0'
  WriteRegStr SHCTX "Software\Classes\PlasmidCraft.protein\shell\open\command" "" '$\"$INSTDIR\${MAINBINARYNAME}.exe$\" $\"%1$\"'
  WriteRegStr SHCTX "Software\Classes\.pcprotein\OpenWithProgids" "PlasmidCraft.protein" ""
  WriteRegStr SHCTX "Software\Classes\PlasmidCraft.genbank" "" "GenBank Sequence"
  WriteRegStr SHCTX "Software\Classes\PlasmidCraft.genbank\DefaultIcon" "" '$\"$INSTDIR\document.ico$\",0'
  WriteRegStr SHCTX "Software\Classes\PlasmidCraft.genbank\shell\open\command" "" '$\"$INSTDIR\${MAINBINARYNAME}.exe$\" $\"%1$\"'
  WriteRegStr SHCTX "Software\Classes\.gb\OpenWithProgids" "PlasmidCraft.genbank" ""
  WriteRegStr SHCTX "Software\Classes\.gbk\OpenWithProgids" "PlasmidCraft.genbank" ""
  WriteRegStr SHCTX "Software\Classes\.genbank\OpenWithProgids" "PlasmidCraft.genbank" ""
  WriteRegStr SHCTX "Software\Classes\PlasmidCraft.fasta" "" "FASTA Sequence"
  WriteRegStr SHCTX "Software\Classes\PlasmidCraft.fasta\DefaultIcon" "" '$\"$INSTDIR\document.ico$\",0'
  WriteRegStr SHCTX "Software\Classes\PlasmidCraft.fasta\shell\open\command" "" '$\"$INSTDIR\${MAINBINARYNAME}.exe$\" $\"%1$\"'
  WriteRegStr SHCTX "Software\Classes\.fa\OpenWithProgids" "PlasmidCraft.fasta" ""
  WriteRegStr SHCTX "Software\Classes\.fasta\OpenWithProgids" "PlasmidCraft.fasta" ""
  WriteRegStr SHCTX "Software\Classes\.fna\OpenWithProgids" "PlasmidCraft.fasta" ""
  WriteRegStr SHCTX "Software\Classes\PlasmidCraft.protein-fasta" "" "Protein Sequence"
  WriteRegStr SHCTX "Software\Classes\PlasmidCraft.protein-fasta\DefaultIcon" "" '$\"$INSTDIR\document.ico$\",0'
  WriteRegStr SHCTX "Software\Classes\PlasmidCraft.protein-fasta\shell\open\command" "" '$\"$INSTDIR\${MAINBINARYNAME}.exe$\" $\"%1$\"'
  WriteRegStr SHCTX "Software\Classes\.faa\OpenWithProgids" "PlasmidCraft.protein-fasta" ""
  WriteRegStr SHCTX "Software\Classes\.pep\OpenWithProgids" "PlasmidCraft.protein-fasta" ""
  WriteRegStr SHCTX "Software\Classes\PlasmidCraft.dna" "" "SnapGene DNA Sequence"
  WriteRegStr SHCTX "Software\Classes\PlasmidCraft.dna\DefaultIcon" "" '$\"$INSTDIR\document.ico$\",0'
  WriteRegStr SHCTX "Software\Classes\PlasmidCraft.dna\shell\open\command" "" '$\"$INSTDIR\${MAINBINARYNAME}.exe$\" $\"%1$\"'
  WriteRegStr SHCTX "Software\Classes\.dna\OpenWithProgids" "PlasmidCraft.dna" ""
  WriteRegStr SHCTX "Software\Classes\PlasmidCraft.trace" "" "Sanger Trace"
  WriteRegStr SHCTX "Software\Classes\PlasmidCraft.trace\DefaultIcon" "" '$\"$INSTDIR\document.ico$\",0'
  WriteRegStr SHCTX "Software\Classes\PlasmidCraft.trace\shell\open\command" "" '$\"$INSTDIR\${MAINBINARYNAME}.exe$\" $\"%1$\"'
  WriteRegStr SHCTX "Software\Classes\.ab1\OpenWithProgids" "PlasmidCraft.trace" ""
  WriteRegStr SHCTX "Software\RegisteredApplications" "PlasmidCraft" "Software\PlasmidCraft\Capabilities"
  WriteRegStr SHCTX "Software\PlasmidCraft\Capabilities" "ApplicationName" "PlasmidCraft"
  WriteRegStr SHCTX "Software\PlasmidCraft\Capabilities" "ApplicationDescription" "Plasmid sequence workspace"
  WriteRegStr SHCTX "Software\PlasmidCraft\Capabilities\FileAssociations" ".pcraft" "PlasmidCraft.project"
  WriteRegStr SHCTX "Software\PlasmidCraft\Capabilities\FileAssociations" ".pcprotein" "PlasmidCraft.protein"
  WriteRegStr SHCTX "Software\PlasmidCraft\Capabilities\FileAssociations" ".gb" "PlasmidCraft.genbank"
  WriteRegStr SHCTX "Software\PlasmidCraft\Capabilities\FileAssociations" ".gbk" "PlasmidCraft.genbank"
  WriteRegStr SHCTX "Software\PlasmidCraft\Capabilities\FileAssociations" ".genbank" "PlasmidCraft.genbank"
  WriteRegStr SHCTX "Software\PlasmidCraft\Capabilities\FileAssociations" ".fa" "PlasmidCraft.fasta"
  WriteRegStr SHCTX "Software\PlasmidCraft\Capabilities\FileAssociations" ".fasta" "PlasmidCraft.fasta"
  WriteRegStr SHCTX "Software\PlasmidCraft\Capabilities\FileAssociations" ".fna" "PlasmidCraft.fasta"
  WriteRegStr SHCTX "Software\PlasmidCraft\Capabilities\FileAssociations" ".faa" "PlasmidCraft.protein-fasta"
  WriteRegStr SHCTX "Software\PlasmidCraft\Capabilities\FileAssociations" ".pep" "PlasmidCraft.protein-fasta"
  WriteRegStr SHCTX "Software\PlasmidCraft\Capabilities\FileAssociations" ".dna" "PlasmidCraft.dna"
  WriteRegStr SHCTX "Software\PlasmidCraft\Capabilities\FileAssociations" ".ab1" "PlasmidCraft.trace"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  DeleteRegValue SHCTX "Software\Classes\.pcraft\OpenWithProgids" "PlasmidCraft.project"
  DeleteRegKey SHCTX "Software\Classes\PlasmidCraft.project"
  DeleteRegValue SHCTX "Software\Classes\.pcprotein\OpenWithProgids" "PlasmidCraft.protein"
  DeleteRegKey SHCTX "Software\Classes\PlasmidCraft.protein"
  DeleteRegValue SHCTX "Software\Classes\.gb\OpenWithProgids" "PlasmidCraft.genbank"
  DeleteRegValue SHCTX "Software\Classes\.gbk\OpenWithProgids" "PlasmidCraft.genbank"
  DeleteRegValue SHCTX "Software\Classes\.genbank\OpenWithProgids" "PlasmidCraft.genbank"
  DeleteRegKey SHCTX "Software\Classes\PlasmidCraft.genbank"
  DeleteRegValue SHCTX "Software\Classes\.fa\OpenWithProgids" "PlasmidCraft.fasta"
  DeleteRegValue SHCTX "Software\Classes\.fasta\OpenWithProgids" "PlasmidCraft.fasta"
  DeleteRegValue SHCTX "Software\Classes\.fna\OpenWithProgids" "PlasmidCraft.fasta"
  DeleteRegKey SHCTX "Software\Classes\PlasmidCraft.fasta"
  DeleteRegValue SHCTX "Software\Classes\.faa\OpenWithProgids" "PlasmidCraft.protein-fasta"
  DeleteRegValue SHCTX "Software\Classes\.pep\OpenWithProgids" "PlasmidCraft.protein-fasta"
  DeleteRegKey SHCTX "Software\Classes\PlasmidCraft.protein-fasta"
  DeleteRegValue SHCTX "Software\Classes\.dna\OpenWithProgids" "PlasmidCraft.dna"
  DeleteRegKey SHCTX "Software\Classes\PlasmidCraft.dna"
  DeleteRegValue SHCTX "Software\Classes\.ab1\OpenWithProgids" "PlasmidCraft.trace"
  DeleteRegKey SHCTX "Software\Classes\PlasmidCraft.trace"
  DeleteRegValue SHCTX "Software\RegisteredApplications" "PlasmidCraft"
  DeleteRegKey SHCTX "Software\PlasmidCraft\Capabilities"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend
